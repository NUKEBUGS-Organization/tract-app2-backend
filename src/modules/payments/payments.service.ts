import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Payment, PaymentDocument } from './schemas/payment.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'

const PLATFORM_FEE_RATE = 0.0075

type PayPalLink = { href: string; rel: string; method?: string }

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name)
  private accessToken: string | null = null
  private accessTokenExpiresAt = 0

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    private readonly config: ConfigService,
  ) {}

  private apiBase(): string {
    const mode = this.config.get<string>('paypal.mode') ?? 'sandbox'
    return mode === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com'
  }

  private assertConfigured() {
    const clientId = this.config.get<string>('paypal.clientId') ?? ''
    const clientSecret = this.config.get<string>('paypal.clientSecret') ?? ''
    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.',
      )
    }
  }

  private feeAmount(purchasePrice: number): number {
    return Math.round(purchasePrice * PLATFORM_FEE_RATE * 100) / 100
  }

  /** Idempotent: ensure buyer + wholesaler platform_fee rows exist for the deal. */
  async ensurePlatformFeePayments(dealId: string): Promise<PaymentDocument[]> {
    if (!Types.ObjectId.isValid(dealId)) return []

    const deal = await this.dealModel.findById(dealId).lean().exec()
    if (!deal) return []

    const listing = await this.listingModel
      .findById(deal.listingId)
      .select('purchasePrice')
      .lean()
      .exec()
    const purchasePrice = Number(listing?.purchasePrice ?? 0)
    if (!(purchasePrice > 0)) {
      this.logger.error(
        `Cannot create platform fees for deal ${dealId}: listing purchasePrice missing or 0`,
      )
      return []
    }

    const amount = this.feeAmount(purchasePrice)
    const parties: Array<{ party: 'buyer' | 'wholesaler'; userId: Types.ObjectId }> = [
      { party: 'buyer', userId: deal.primaryBuyerId as Types.ObjectId },
      { party: 'wholesaler', userId: deal.wholesalerId as Types.ObjectId },
    ]

    const results: PaymentDocument[] = []
    for (const { party, userId } of parties) {
      const existing = await this.paymentModel
        .findOne({
          dealId: deal._id,
          party,
          paymentType: 'platform_fee',
        })
        .exec()
      if (existing) {
        results.push(existing)
        continue
      }
      try {
        const created = await this.paymentModel.create({
          userId,
          dealId: deal._id,
          paymentType: 'platform_fee',
          party,
          amount,
          currency: 'USD',
          status: 'pending',
        })
        results.push(created)
      } catch (err: unknown) {
        const code =
          err && typeof err === 'object' && 'code' in err
            ? (err as { code?: number }).code
            : undefined
        if (code === 11000) {
          const again = await this.paymentModel
            .findOne({ dealId: deal._id, party, paymentType: 'platform_fee' })
            .exec()
          if (again) results.push(again)
          continue
        }
        throw err
      }
    }
    return results
  }

  async assertDealPlatformFeesPaid(dealId: string): Promise<void> {
    await this.ensurePlatformFeePayments(dealId)
    const fees = await this.paymentModel
      .find({ dealId: new Types.ObjectId(dealId), paymentType: 'platform_fee' })
      .lean()
      .exec()

    if (fees.length < 2) {
      throw new ForbiddenException(
        'Platform fees are not ready (listing purchase price may be missing). Contact support.',
      )
    }

    const unpaid = fees.filter((f) => f.status !== 'succeeded')
    if (unpaid.length > 0) {
      throw new ForbiddenException(
        'Both parties must pay the 0.75% platform fee via PayPal before advancing the deal.',
      )
    }
  }

  async getDealFees(dealId: string, userId: string) {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId).lean().exec()
    if (!deal) throw new NotFoundException('Deal not found.')

    const isParty =
      deal.primaryBuyerId.toString() === userId ||
      deal.wholesalerId.toString() === userId
    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    const payments = await this.ensurePlatformFeePayments(dealId)
    const bothPaid = payments.length >= 2 && payments.every((p) => p.status === 'succeeded')
    const mine = payments.find((p) => p.userId.toString() === userId) ?? null

    return {
      purchasePriceBasis: payments[0]
        ? Math.round((payments[0].amount / PLATFORM_FEE_RATE) * 100) / 100
        : null,
      ratePercent: 0.75,
      bothPaid,
      myPayment: mine ? this.toPublic(mine) : null,
      payments: payments.map((p) => this.toPublic(p)),
    }
  }

  async createPayPalOrder(paymentId: string, userId: string) {
    this.assertConfigured()
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found.')
    }

    const payment = await this.paymentModel.findById(paymentId).exec()
    if (!payment) throw new NotFoundException('Payment not found.')
    if (payment.userId.toString() !== userId) {
      throw new ForbiddenException('You can only pay your own platform fee.')
    }
    if (payment.status === 'succeeded') {
      return {
        alreadyPaid: true,
        payment: this.toPublic(payment),
        orderId: payment.paypalOrderId,
        approveUrl: null as string | null,
      }
    }

    if (payment.paypalOrderId && payment.status === 'pending') {
      const existing = await this.paypalGetOrder(payment.paypalOrderId)
      const approveUrl = this.findApproveUrl(existing?.links)
      if (approveUrl && existing?.status !== 'COMPLETED' && existing?.status !== 'VOIDED') {
        return {
          alreadyPaid: false,
          payment: this.toPublic(payment),
          orderId: payment.paypalOrderId,
          approveUrl,
        }
      }
    }

    const frontendUrl = (this.config.get<string>('frontendUrl') ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    )
    const returnUrl = `${frontendUrl}/deals/${payment.dealId}?paypal=return&paymentId=${payment._id}`
    const cancelUrl = `${frontendUrl}/deals/${payment.dealId}?paypal=cancel&paymentId=${payment._id}`

    const order = await this.paypalRequest<{
      id: string
      status: string
      links?: PayPalLink[]
    }>('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: payment._id.toString(),
          description: 'TRACT platform fee (0.75% of purchase price)',
          custom_id: payment._id.toString(),
          amount: {
            currency_code: payment.currency || 'USD',
            value: payment.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        brand_name: 'Buy TRACT',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    })

    payment.paypalOrderId = order.id
    payment.status = 'pending'
    payment.failureReason = null
    await payment.save()

    return {
      alreadyPaid: false,
      payment: this.toPublic(payment),
      orderId: order.id,
      approveUrl: this.findApproveUrl(order.links),
    }
  }

  async capturePayPalOrder(paymentId: string, userId: string, orderId?: string) {
    this.assertConfigured()
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new NotFoundException('Payment not found.')
    }

    const payment = await this.paymentModel.findById(paymentId).exec()
    if (!payment) throw new NotFoundException('Payment not found.')
    if (payment.userId.toString() !== userId) {
      throw new ForbiddenException('You can only pay your own platform fee.')
    }
    if (payment.status === 'succeeded') {
      return { payment: this.toPublic(payment) }
    }

    const oid = orderId || payment.paypalOrderId
    if (!oid) {
      throw new BadRequestException('No PayPal order to capture. Start checkout again.')
    }

    try {
      const captured = await this.paypalRequest<{
        id: string
        status: string
        purchase_units?: Array<{
          payments?: { captures?: Array<{ id: string; status: string }> }
        }>
      }>('POST', `/v2/checkout/orders/${oid}/capture`, {})

      const captureId =
        captured.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null
      const captureStatus =
        captured.purchase_units?.[0]?.payments?.captures?.[0]?.status ?? captured.status

      if (captureStatus === 'COMPLETED' || captured.status === 'COMPLETED') {
        await this.markSucceeded(payment, oid, captureId)
      } else {
        payment.status = 'failed'
        payment.failureReason = `PayPal status: ${captureStatus}`
        await payment.save()
        throw new BadRequestException('PayPal payment was not completed. Please try again.')
      }
    } catch (err) {
      if (err instanceof BadRequestException || err instanceof ForbiddenException) throw err
      const msg = err instanceof Error ? err.message : 'Capture failed'
      // Idempotent: order may already be captured
      if (/ORDER_ALREADY_CAPTURED|already captured/i.test(msg)) {
        await this.markSucceeded(payment, oid, payment.paypalCaptureId)
      } else {
        payment.status = 'failed'
        payment.failureReason = msg.slice(0, 500)
        await payment.save()
        throw new BadRequestException(msg)
      }
    }

    const fresh = await this.paymentModel.findById(paymentId).exec()
    return { payment: this.toPublic(fresh as PaymentDocument) }
  }

  /** Webhook backup — mark succeeded by PayPal order id / custom_id. */
  async handlePayPalWebhook(body: Record<string, unknown>) {
    const eventType = String(body.event_type ?? '')
    if (
      eventType !== 'PAYMENT.CAPTURE.COMPLETED' &&
      eventType !== 'CHECKOUT.ORDER.APPROVED'
    ) {
      return { ignored: true, eventType }
    }

    const resource = (body.resource ?? {}) as Record<string, unknown>
    let orderId: string | null =
      typeof resource.supplementary_data === 'object' &&
      resource.supplementary_data &&
      typeof (resource.supplementary_data as { related_ids?: { order_id?: string } }).related_ids
        ?.order_id === 'string'
        ? (resource.supplementary_data as { related_ids: { order_id: string } }).related_ids
            .order_id
        : null

    if (!orderId && typeof resource.id === 'string' && eventType === 'CHECKOUT.ORDER.APPROVED') {
      orderId = resource.id
    }

    const customId =
      typeof resource.custom_id === 'string'
        ? resource.custom_id
        : typeof (resource as { purchase_units?: Array<{ custom_id?: string }> }).purchase_units?.[0]
              ?.custom_id === 'string'
          ? (resource as { purchase_units: Array<{ custom_id: string }> }).purchase_units[0]
              .custom_id
          : null

    let payment: PaymentDocument | null = null
    if (customId && Types.ObjectId.isValid(customId)) {
      payment = await this.paymentModel.findById(customId).exec()
    }
    if (!payment && orderId) {
      payment = await this.paymentModel.findOne({ paypalOrderId: orderId }).exec()
    }
    if (!payment) {
      this.logger.warn(`PayPal webhook: payment not found event=${eventType}`)
      return { ignored: true, reason: 'payment_not_found' }
    }
    if (payment.status === 'succeeded') {
      return { ok: true, alreadyPaid: true }
    }

    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const captureId = typeof resource.id === 'string' ? resource.id : null
      await this.markSucceeded(payment, payment.paypalOrderId ?? orderId, captureId)
      return { ok: true }
    }

    // ORDER.APPROVED — try capture server-side
    if (payment.paypalOrderId || orderId) {
      try {
        await this.capturePayPalOrder(
          payment._id.toString(),
          payment.userId.toString(),
          payment.paypalOrderId ?? orderId ?? undefined,
        )
      } catch (err) {
        this.logger.warn(
          `PayPal webhook capture failed for ${payment._id}: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
    return { ok: true }
  }

  private async markSucceeded(
    payment: PaymentDocument,
    orderId: string | null,
    captureId: string | null,
  ) {
    payment.status = 'succeeded'
    if (orderId) payment.paypalOrderId = orderId
    if (captureId) payment.paypalCaptureId = captureId
    payment.processedAt = new Date()
    payment.failureReason = null
    await payment.save()
    this.logger.log(
      `Platform fee paid: payment=${payment._id} deal=${payment.dealId} party=${payment.party}`,
    )
  }

  private toPublic(p: PaymentDocument) {
    return {
      id: p._id.toString(),
      dealId: p.dealId.toString(),
      userId: p.userId.toString(),
      paymentType: p.paymentType,
      party: p.party,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      paypalOrderId: p.paypalOrderId,
      processedAt: p.processedAt?.toISOString() ?? null,
      failureReason: p.failureReason,
    }
  }

  private findApproveUrl(links?: PayPalLink[]): string | null {
    return links?.find((l) => l.rel === 'approve')?.href ?? null
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt - 30_000) {
      return this.accessToken
    }
    this.assertConfigured()
    const clientId = this.config.get<string>('paypal.clientId') ?? ''
    const clientSecret = this.config.get<string>('paypal.clientSecret') ?? ''
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(`${this.apiBase()}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    })
    if (!res.ok) {
      const text = await res.text()
      this.logger.error(`PayPal token error: ${res.status} ${text}`)
      throw new ServiceUnavailableException('Could not authenticate with PayPal.')
    }
    const data = (await res.json()) as { access_token: string; expires_in: number }
    this.accessToken = data.access_token
    this.accessTokenExpiresAt = Date.now() + (data.expires_in ?? 300) * 1000
    return this.accessToken
  }

  private async paypalGetOrder(orderId: string) {
    try {
      return await this.paypalRequest<{ status: string; links?: PayPalLink[] }>(
        'GET',
        `/v2/checkout/orders/${orderId}`,
      )
    } catch {
      return null
    }
  }

  private async paypalRequest<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const token = await this.getAccessToken()
    const res = await fetch(`${this.apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text }
    }
    if (!res.ok) {
      const msg =
        typeof data === 'object' &&
        data &&
        'message' in data &&
        typeof (data as { message: unknown }).message === 'string'
          ? (data as { message: string }).message
          : text.slice(0, 300)
      this.logger.error(`PayPal ${method} ${path} → ${res.status}: ${msg}`)
      throw new BadRequestException(msg || `PayPal error ${res.status}`)
    }
    return data as T
  }
}
