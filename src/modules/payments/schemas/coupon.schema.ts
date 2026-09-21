import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type CouponDocument = Coupon & Document

/**
 * Beta access coupon. A redeemed coupon waives the whole SaaS subscription
 * (percentOff 100 → $0 due) until `freeUntil`, without creating a PayPal
 * subscription. Codes are stored and compared upper-cased.
 */
@Schema({ timestamps: true, collection: 'app2_coupons' })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true })
  code: string

  @Prop({ default: 'Beta access' })
  description: string

  /** 100 = the bill becomes $0. Only 100 is supported today. */
  @Prop({ required: true, min: 1, max: 100, default: 100 })
  percentOff: number

  /** Free access runs through this instant, then normal billing resumes. */
  @Prop({ type: Date, required: true })
  freeUntil: Date

  /** Roles allowed to redeem. Empty means every role that pays. */
  @Prop({ type: [String], default: [] })
  allowedRoles: string[]

  /** null = unlimited redemptions. */
  @Prop({ type: Number, default: null })
  maxRedemptions: number | null

  @Prop({ default: 0 })
  redemptionCount: number

  @Prop({ default: true })
  active: boolean
}

export const CouponSchema = SchemaFactory.createForClass(Coupon)
