import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ConfigService } from '@nestjs/config'
import { Model, Types } from 'mongoose'
import { randomUUID } from 'crypto'
import { PaymentsService } from './payments.service'
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema'
import { CouponRedemption, CouponRedemptionDocument } from './schemas/coupon-redemption.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { paidThrough, PaypalSubscriptionDetails, subscriptionAmount } from './subscription-policy'
import { COUPON_STATUS } from './coupons.service'

export const BETA_TERMS_VERSION = '2026-09-07'

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly paypal: PaymentsService,
    private readonly config: ConfigService,
    @Optional() @InjectModel(CouponRedemption.name) private readonly redemptions?: Model<CouponRedemptionDocument>,
  ) {}

  private async tier(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found.')
    const user = await this.users.findById(userId).select('role').lean().exec()
    if (!user) throw new NotFoundException('User not found.')
    return subscriptionAmount(user.role)
  }

  private subscriptionMode(): string {
    return this.config.get<string>('SUBSCRIPTION_MODE') ?? 'mock'
  }

  private isPaid(row: SubscriptionDocument | null, amount: number | null) {
    return amount === null || Boolean(row && row.amount === amount && row.paidUntil && row.paidUntil.getTime() > Date.now() && ['ACTIVE', 'CANCELLED', 'EXPIRED', 'PAID_TEST', 'COUPON'].includes(row.status))
  }

  /** A live coupon waives the whole fee; amountDue is what the user actually owes now. */
  private couponActive(row: SubscriptionDocument | null): boolean {
    return Boolean(row?.couponCode && row.couponFreeUntil && row.couponFreeUntil.getTime() > Date.now())
  }

  private result(row: SubscriptionDocument | null, amount: number | null) {
    const coupon = this.couponActive(row)
    return {
      required: amount !== null, amount, currency: 'USD', interval: 'month',
      // amount stays the list price so the UI can show "$100 $0".
      amountDue: amount === null ? null : coupon ? 0 : amount,
      active: this.isPaid(row, amount), status: row?.status ?? 'NONE',
      paidUntil: row?.paidUntil ?? null,
      canCancel: Boolean(row?.paypalSubscriptionId && ['ACTIVE', 'SUSPENDED', 'APPROVAL_PENDING', 'APPROVED'].includes(row.status)),
      termsVersion: BETA_TERMS_VERSION,
      mock: row?.status === 'PAID_TEST',
      coupon: coupon
        ? { code: row!.couponCode!, amountWaived: row!.couponAmountWaived ?? amount, freeUntil: row!.couponFreeUntil! }
        : null,
    }
  }

  private async repairCouponStatus(userId: string, amount: number | null) {
    if (amount === null || !this.redemptions) return null
    const redemption = await this.redemptions
      .findOne({ userId: new Types.ObjectId(userId), freeUntil: { $gt: new Date() } })
      .lean()
      .exec()
    if (!redemption) return null
    const now = new Date()
    return this.subscriptions
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: {
            amount,
            planId: COUPON_STATUS,
            requestId: `coupon:${redemption.code}:${userId}`,
            paypalSubscriptionId: null,
            approvalUrl: null,
            status: COUPON_STATUS,
            paidUntil: redemption.freeUntil,
            lastPaymentAt: null,
            revokedPaymentAt: null,
            syncedAt: now,
            termsAcceptedAt: now,
            termsVersion: BETA_TERMS_VERSION,
            couponCode: redemption.code,
            couponAmountWaived: redemption.amountWaived,
            couponFreeUntil: redemption.freeUntil,
            couponRedeemedAt: now,
          },
        },
        { upsert: true, new: true },
      )
      .exec()
  }

  async getStatus(userId: string, refresh = false) {
    const amount = await this.tier(userId)
    let row: SubscriptionDocument | null = await this.subscriptions.findOne({ userId }).exec()
    if (!this.isPaid(row, amount)) {
      row = await this.repairCouponStatus(userId, amount) ?? row
    }
    if (this.subscriptionMode() === 'paypal' && row?.paypalSubscriptionId && (refresh || !row.syncedAt || Date.now() - row.syncedAt.getTime() > 60_000)) {
      row = await this.sync(row)
    }
    return this.result(row, amount)
  }

  async assertCanExecute(userId: string): Promise<void> {
    // Explicit beta UI-only billing mode: no payment record or PayPal call is made.
    if (this.subscriptionMode() === 'mock') return
    const status = await this.getStatus(userId, true)
    if (!status.active) throw new ForbiddenException({
      code: 'SUBSCRIPTION_REQUIRED',
      message: `Pay your $${status.amount}/month SaaS subscription before executing a contract or digital assignment.`,
    })
  }

  async mockCheckout(userId: string) {
    if (this.subscriptionMode() !== 'mock') {
      throw new ForbiddenException('Mock checkout is only available in mock mode.')
    }
    const amount = await this.tier(userId)
    if (amount === null) throw new BadRequestException('Your role does not require a subscription.')
    const now = new Date()
    const paidUntil = new Date(now)
    paidUntil.setMonth(paidUntil.getMonth() + 1)
    const row = await this.subscriptions.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $set: {
        amount,
        planId: 'PAID_TEST',
        requestId: `mock:${userId}`,
        paypalSubscriptionId: null,
        approvalUrl: null,
        status: 'PAID_TEST',
        paidUntil,
        lastPaymentAt: now,
        revokedPaymentAt: null,
        syncedAt: now,
        termsAcceptedAt: now,
        termsVersion: BETA_TERMS_VERSION,
      } },
      { upsert: true, new: true },
    ).exec()
    return this.result(row, amount)
  }

  async cardCheckoutConfig(userId: string) {
    if (this.subscriptionMode() === 'mock') throw new ForbiddenException('Card checkout is only available in PayPal mode.')
    const amount = await this.tier(userId)
    if (amount === null) throw new BadRequestException('Your role does not require a subscription.')
    const planId = this.config.get<string>(amount === 50 ? 'paypal.wholesalerPlanId' : 'paypal.buyerPlanId')
    const clientId = this.config.get<string>('paypal.clientId') ?? ''
    const mode = this.config.get<string>('paypal.mode') ?? 'sandbox'
    if (!planId || !clientId) throw new ServiceUnavailableException('Subscriptions are not configured yet. Please contact support.')
    return { clientId, planId, amount, currency: 'USD', termsVersion: BETA_TERMS_VERSION, mode }
  }

  async confirmClientSubscription(userId: string, subscriptionId: string, termsVersion: string) {
    if (termsVersion !== BETA_TERMS_VERSION) throw new BadRequestException('Accept the current subscription terms to continue.')
    if (this.subscriptionMode() === 'mock') return this.mockCheckout(userId)
    const amount = await this.tier(userId)
    if (amount === null) throw new BadRequestException('Your role does not require a subscription.')
    const expectedPlanId = this.config.get<string>(amount === 50 ? 'paypal.wholesalerPlanId' : 'paypal.buyerPlanId')
    if (!expectedPlanId) throw new ServiceUnavailableException('Subscriptions are not configured yet. Please contact support.')
    const details = await this.paypal.subscriptionRequest<PaypalSubscriptionDetails>(
      'GET',
      `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`,
    )
    if (details.id !== subscriptionId || details.plan_id !== expectedPlanId) {
      throw new ForbiddenException('PayPal subscription ownership or plan does not match.')
    }
    if (details.custom_id && details.custom_id !== userId) {
      throw new ForbiddenException('PayPal subscription ownership or plan does not match.')
    }
    const lastPaymentAt = new Date(details.billing_info?.last_payment?.time ?? '')
    const row = await this.subscriptions.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $set: {
        amount,
        planId: expectedPlanId,
        requestId: `client:${subscriptionId}`,
        paypalSubscriptionId: subscriptionId,
        approvalUrl: details.links?.find((link) => link.rel === 'approve')?.href ?? null,
        status: details.status ?? 'APPROVAL_PENDING',
        paidUntil: paidThrough(details, amount),
        lastPaymentAt: Number.isFinite(lastPaymentAt.getTime()) ? lastPaymentAt : null,
        revokedPaymentAt: null,
        syncedAt: new Date(),
        termsAcceptedAt: new Date(),
        termsVersion,
      } },
      { upsert: true, new: true },
    ).exec()
    return this.result(row, amount)
  }

  async create(userId: string, termsVersion: string) {
    if (termsVersion !== BETA_TERMS_VERSION) throw new BadRequestException('Accept the current subscription terms to continue.')
    if (this.subscriptionMode() === 'mock') return this.mockCheckout(userId)
    const amount = await this.tier(userId)
    if (amount === null) throw new BadRequestException('Your role does not require a subscription.')
    // A live coupon means $0 is due, so there is nothing to bill through PayPal.
    const existing = await this.subscriptions.findOne({ userId }).exec()
    if (this.couponActive(existing)) return { ...this.result(existing, amount), approvalUrl: null }
    const planId = this.config.get<string>(amount === 50 ? 'paypal.wholesalerPlanId' : 'paypal.buyerPlanId')
    if (!planId) throw new ServiceUnavailableException('Subscriptions are not configured yet. Please contact support.')
    let row: SubscriptionDocument | null = await this.subscriptions.findOne({ userId }).exec()
    if (row?.paypalSubscriptionId) {
      row = await this.sync(row)
      if (this.isPaid(row, row.amount)) return { ...this.result(row, amount), approvalUrl: null }
      if (['APPROVAL_PENDING', 'APPROVED', 'ACTIVE', 'SUSPENDED'].includes(row.status)) {
        if (row.amount !== amount) throw new BadRequestException('Cancel your previous subscription before changing tiers.')
        return { ...this.result(row, amount), approvalUrl: row.approvalUrl }
      }
      // Replace only the same terminal subscription observed above; concurrent callers reuse the winner.
      await this.subscriptions.updateOne({ _id: row._id, paypalSubscriptionId: row.paypalSubscriptionId, status: row.status }, {
        $set: { status: 'CREATING', paypalSubscriptionId: null, approvalUrl: null, requestId: randomUUID(), amount, planId, paidUntil: null, lastPaymentAt: null, revokedPaymentAt: null, termsAcceptedAt: new Date(), termsVersion },
      }).exec()
    }
    try {
      row = await this.subscriptions.findOneAndUpdate({ userId }, { $setOnInsert: {
        userId: new Types.ObjectId(userId), amount, planId, requestId: randomUUID(), termsAcceptedAt: new Date(), termsVersion,
      } }, { upsert: true, new: true }).exec()
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err
      row = await this.subscriptions.findOne({ userId }).exec()
    }
    if (!row) throw new ServiceUnavailableException('Could not start your subscription. Please retry.')
    if (row.paypalSubscriptionId) return { ...this.result(row, amount), approvalUrl: row.approvalUrl }
    // The persisted request ID makes concurrent/retried creation idempotent at PayPal.
    const origin = this.config.get<string>('frontendUrl') ?? 'http://localhost:5173'
    const details = await this.paypal.subscriptionRequest<PaypalSubscriptionDetails>('POST', '/v1/billing/subscriptions', {
      plan_id: row.planId, custom_id: userId,
      application_context: { brand_name: 'Buy TRACT', user_action: 'SUBSCRIBE_NOW', shipping_preference: 'NO_SHIPPING',
        return_url: `${origin}/settings/subscription?paypal=return`, cancel_url: `${origin}/settings/subscription?paypal=cancel` },
    }, row.requestId)
    if (!details.id) throw new ServiceUnavailableException('PayPal did not return a subscription. Please retry.')
    const approvalUrl = details.links?.find((link) => link.rel === 'approve')?.href ?? null
    await this.subscriptions.updateOne({ _id: row._id, requestId: row.requestId }, { $set: {
      paypalSubscriptionId: details.id, status: details.status ?? 'APPROVAL_PENDING', approvalUrl,
    } }).exec()
    return { ...this.result(row, amount), approvalUrl }
  }

  private async sync(row: SubscriptionDocument): Promise<SubscriptionDocument> {
    const details = await this.paypal.subscriptionRequest<PaypalSubscriptionDetails>('GET', `/v1/billing/subscriptions/${encodeURIComponent(row.paypalSubscriptionId! )}`)
    if (details.id !== row.paypalSubscriptionId || details.custom_id !== row.userId.toString() || details.plan_id !== row.planId) {
      throw new ForbiddenException('PayPal subscription ownership or plan does not match.')
    }
    const lastPaymentAt = new Date(details.billing_info?.last_payment?.time ?? '')
    const revoked = row.revokedPaymentAt && (!Number.isFinite(lastPaymentAt.getTime()) || lastPaymentAt <= row.revokedPaymentAt)
    const updated = await this.subscriptions.findOneAndUpdate({ _id: row._id, paypalSubscriptionId: row.paypalSubscriptionId, revokedPaymentAt: row.revokedPaymentAt ?? null }, { $set: {
      status: details.status ?? 'UNKNOWN', paidUntil: revoked ? null : paidThrough(details, row.amount),
      lastPaymentAt: Number.isFinite(lastPaymentAt.getTime()) ? lastPaymentAt : null,
      approvalUrl: details.links?.find((link) => link.rel === 'approve')?.href ?? row.approvalUrl,
      syncedAt: new Date(),
    } }, { new: true }).exec()
    return updated ?? (await this.subscriptions.findById(row._id).exec()) ?? row
  }

  async cancel(userId: string) {
    const row = await this.subscriptions.findOne({ userId }).exec()
    if (!row?.paypalSubscriptionId) throw new NotFoundException('Subscription not found.')
    if (this.subscriptionMode() === 'mock') {
      await this.subscriptions.updateOne({ _id: row._id }, { $set: { status: 'CANCELLED', approvalUrl: null, syncedAt: new Date() } }).exec()
      return this.getStatus(userId, false)
    }
    if (!['CANCELLED', 'EXPIRED'].includes(row.status)) {
      await this.paypal.subscriptionRequest('POST', `/v1/billing/subscriptions/${encodeURIComponent(row.paypalSubscriptionId)}/cancel`, { reason: 'Cancelled by the subscriber in Buy TRACT.' })
      await this.subscriptions.updateOne({ _id: row._id, paypalSubscriptionId: row.paypalSubscriptionId }, { $set: { status: 'CANCELLED', approvalUrl: null, syncedAt: new Date() } }).exec()
    }
    return this.getStatus(userId, true)
  }

  /** Called only after PayPal signature verification. Re-fetch authoritative state for out-of-order events. */
  async handleWebhook(body: Record<string, unknown>) {
    if (this.subscriptionMode() === 'mock') return { received: true, ignored: true }
    const type = String(body.event_type ?? '')
    const resource = (body.resource ?? {}) as Record<string, unknown>
    const isRevocation = ['PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'].includes(type)
    let id = type.startsWith('BILLING.SUBSCRIPTION.') ? resource.id : resource.billing_agreement_id
    let revokedPaymentAt: Date | null = null
    if (isRevocation) {
      // Refund resources identify a sale, not necessarily the billing agreement.
      // Use the original sale date so late/duplicate refunds cannot revoke a later paid cycle.
      const saleId = typeof resource.sale_id === 'string' ? resource.sale_id : type === 'PAYMENT.SALE.REVERSED' ? resource.id : null
      if (typeof saleId === 'string') {
        const sale = await this.paypal.subscriptionRequest<{ id?: string; billing_agreement_id?: string; create_time?: string }>(
          'GET', `/v1/payments/sale/${encodeURIComponent(saleId)}`,
        )
        if (sale.id !== saleId) throw new ForbiddenException('PayPal refunded sale does not match.')
        id = sale.billing_agreement_id
        const created = new Date(sale.create_time ?? '')
        if (Number.isFinite(created.getTime())) revokedPaymentAt = created
      }
    }
    if (typeof id !== 'string') return { received: true }
    const row = await this.subscriptions.findOne({ paypalSubscriptionId: id }).exec()
    if (!row) return { received: true }
    if (isRevocation) {
      await this.subscriptions.updateOne({ _id: row._id, paypalSubscriptionId: id }, {
        $set: { paidUntil: null }, $max: { revokedPaymentAt: revokedPaymentAt ?? row.lastPaymentAt ?? new Date() },
      }).exec()
      const revoked = await this.subscriptions.findById(row._id).exec()
      if (revoked) await this.sync(revoked)
    } else {
      await this.sync(row)
    }
    return { received: true }
  }
}
