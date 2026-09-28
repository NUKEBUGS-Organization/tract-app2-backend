import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ConfigService } from '@nestjs/config'
import { Model, Types } from 'mongoose'
import { Coupon, CouponDocument } from './schemas/coupon.schema'
import { CouponRedemption, CouponRedemptionDocument } from './schemas/coupon-redemption.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema'
import { subscriptionAmount } from './subscription-policy'
import { BETA_TERMS_VERSION } from './subscriptions.service'

export const COUPON_STATUS = 'COUPON'

export interface CouponPreview {
  code: string
  description: string
  /** Monthly price before the coupon. */
  amountBefore: number
  /** Monthly price after the coupon — 0 for a 100%-off beta code. */
  amountDue: number
  percentOff: number
  freeUntil: Date
}

@Injectable()
export class CouponsService implements OnModuleInit {
  private readonly logger = new Logger(CouponsService.name)

  constructor(
    @InjectModel(Coupon.name) private readonly coupons: Model<CouponDocument>,
    @InjectModel(CouponRedemption.name) private readonly redemptions: Model<CouponRedemptionDocument>,
    @InjectModel(Subscription.name) private readonly subscriptions: Model<SubscriptionDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Seed the configured beta code so operators do not need a separate admin
   * step. Re-running updates the window and limits but never resets the
   * redemption count, so an existing cap keeps its meaning.
   */
  async onModuleInit() {
    const code = this.config.get<string>('betaCoupon.code')?.trim().toUpperCase()
    if (!code) return
    const freeUntil = new Date(this.config.get<string>('betaCoupon.freeUntil') ?? '')
    if (!Number.isFinite(freeUntil.getTime())) {
      this.logger.error('BETA_COUPON_FREE_UNTIL is not a valid date; the beta coupon was not seeded.')
      return
    }
    const maxRedemptions = this.config.get<number | null>('betaCoupon.maxRedemptions') ?? null
    const allowedRoles = this.config.get<string[]>('betaCoupon.allowedRoles') ?? []
    await this.coupons
      .updateOne(
        { code },
        {
          $set: {
            freeUntil,
            maxRedemptions,
            allowedRoles,
            percentOff: 100,
            active: true,
            description:
              this.config.get<string>('betaCoupon.description') ??
              'Beta access — no subscription fee',
          },
          $setOnInsert: { code, redemptionCount: 0 },
        },
        { upsert: true },
      )
      .exec()
    this.logger.log(`Beta coupon "${code}" is active through ${freeUntil.toISOString()}.`)
  }

  private normalize(code: string): string {
    const value = code.trim().toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(value)) {
      throw new NotFoundException('That coupon code is not valid.')
    }
    return value
  }

  private async userTier(userId: string) {
    if (!Types.ObjectId.isValid(userId)) throw new NotFoundException('User not found.')
    const user = await this.users.findById(userId).select('role').lean().exec()
    if (!user) throw new NotFoundException('User not found.')
    const amount = subscriptionAmount(user.role)
    if (amount === null) {
      throw new BadRequestException(
        'Your role does not require a subscription, so a coupon is not needed.',
      )
    }
    return { role: user.role as string, amount }
  }

  private amountDue(amount: number, percentOff: number): number {
    return Math.max(0, Math.round((amount * (100 - percentOff)) / 100))
  }

  private couponPaidUntil(now: Date, freeUntil: Date): Date {
    const paidUntil = new Date(now)
    paidUntil.setMonth(paidUntil.getMonth() + 1)
    return paidUntil < freeUntil ? paidUntil : freeUntil
  }

  private async assertValidCoupon(code: string, role: string): Promise<CouponDocument> {
    const coupon = await this.coupons.findOne({ code }).exec()
    if (!coupon || !coupon.active) throw new NotFoundException('That coupon code is not valid.')
    if (coupon.freeUntil.getTime() <= Date.now()) {
      throw new BadRequestException('That coupon has expired.')
    }
    if (coupon.allowedRoles.length > 0 && !coupon.allowedRoles.includes(role)) {
      throw new BadRequestException('That coupon is not available for your account type.')
    }
    return coupon
  }

  private async grantCouponAccess(userId: string, coupon: CouponDocument, amount: number) {
    const now = new Date()
    const paidUntil = this.couponPaidUntil(now, coupon.freeUntil)
    await this.subscriptions
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: {
            amount,
            planId: COUPON_STATUS,
            requestId: `coupon:${coupon.code}:${userId}`,
            paypalSubscriptionId: null,
            approvalUrl: null,
            status: COUPON_STATUS,
            paidUntil,
            lastPaymentAt: null,
            revokedPaymentAt: null,
            syncedAt: now,
            termsAcceptedAt: now,
            termsVersion: BETA_TERMS_VERSION,
            couponCode: coupon.code,
            couponAmountWaived: amount,
            couponFreeUntil: coupon.freeUntil,
            couponRedeemedAt: now,
          },
        },
        { upsert: true, new: true },
      )
      .exec()
  }

  /**
   * Validate a code for this user without consuming it, so checkout can show
   * "$100 → $0" before the user commits.
   */
  async preview(userId: string, rawCode: string): Promise<CouponPreview> {
    const code = this.normalize(rawCode)
    const { role, amount } = await this.userTier(userId)
    const coupon = await this.assertValidCoupon(code, role)
    const already = await this.redemptions
      .findOne({ couponId: coupon._id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec()
    if (!already && coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) {
      throw new BadRequestException('That coupon has reached its redemption limit.')
    }
    return {
      code: coupon.code,
      description: coupon.description,
      amountBefore: amount,
      amountDue: this.amountDue(amount, coupon.percentOff),
      percentOff: coupon.percentOff,
      freeUntil: coupon.freeUntil,
    }
  }

  /**
   * Redeem the code and grant free access through the coupon window.
   *
   * No PayPal subscription is created: the user owes $0, so there is nothing
   * to bill. When the window ends the entitlement simply lapses and the normal
   * paid flow takes over.
   */
  async redeem(userId: string, rawCode: string) {
    const code = this.normalize(rawCode)
    const { role, amount } = await this.userTier(userId)
    const coupon = await this.assertValidCoupon(code, role)
    const amountDue = this.amountDue(amount, coupon.percentOff)
    if (amountDue > 0) {
      throw new BadRequestException('Partial-discount coupons are not supported yet.')
    }
    const existing = await this.redemptions
      .findOne({ couponId: coupon._id, userId: new Types.ObjectId(userId) })
      .lean()
      .exec()
    if (existing) {
      await this.grantCouponAccess(userId, coupon, amount)
      return {
        code: coupon.code,
        amountBefore: amount,
        amountDue: 0,
        percentOff: coupon.percentOff,
        freeUntil: coupon.freeUntil,
      }
    }
    if (coupon.maxRedemptions !== null && coupon.redemptionCount >= coupon.maxRedemptions) {
      throw new BadRequestException('That coupon has reached its redemption limit.')
    }

    // Claim a redemption slot before granting access, so a capped code cannot
    // be over-redeemed by concurrent requests.
    const claimed = await this.coupons
      .findOneAndUpdate(
        {
          _id: coupon._id,
          active: true,
          freeUntil: { $gt: new Date() },
          $or: [
            { maxRedemptions: null },
            { $expr: { $lt: ['$redemptionCount', '$maxRedemptions'] } },
          ],
        },
        { $inc: { redemptionCount: 1 } },
        { new: true },
      )
      .exec()
    if (!claimed) throw new BadRequestException('That coupon has reached its redemption limit.')

    try {
      await this.redemptions.create({
        couponId: coupon._id,
        code: coupon.code,
        userId: new Types.ObjectId(userId),
        role,
        amountWaived: amount,
        freeUntil: coupon.freeUntil,
      })
    } catch (err) {
      await this.coupons.updateOne({ _id: coupon._id }, { $inc: { redemptionCount: -1 } }).exec()
      if ((err as { code?: number }).code === 11000) {
        await this.grantCouponAccess(userId, coupon, amount)
        return {
          code: coupon.code,
          amountBefore: amount,
          amountDue: 0,
          percentOff: coupon.percentOff,
          freeUntil: coupon.freeUntil,
        }
      }
      throw err
    }

    await this.grantCouponAccess(userId, coupon, amount)

    this.logger.log(
      `Coupon ${coupon.code} redeemed by ${userId} (${role}); $${amount}/mo waived through ${coupon.freeUntil.toISOString()}.`,
    )
    return {
      code: coupon.code,
      amountBefore: amount,
      amountDue: 0,
      percentOff: coupon.percentOff,
      freeUntil: coupon.freeUntil,
    }
  }
}
