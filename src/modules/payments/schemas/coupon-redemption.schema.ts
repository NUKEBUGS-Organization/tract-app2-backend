import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type CouponRedemptionDocument = CouponRedemption & Document

/** One row per (coupon, user). The unique index is what makes redemption once-only. */
@Schema({ timestamps: true, collection: 'app2_coupon_redemptions' })
export class CouponRedemption {
  @Prop({ type: Types.ObjectId, required: true, ref: 'Coupon' })
  couponId: Types.ObjectId

  @Prop({ required: true, uppercase: true })
  code: string

  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true })
  role: string

  /** What the user would have been billed monthly without the coupon. */
  @Prop({ required: true })
  amountWaived: number

  @Prop({ type: Date, required: true })
  freeUntil: Date
}

export const CouponRedemptionSchema = SchemaFactory.createForClass(CouponRedemption)
CouponRedemptionSchema.index({ couponId: 1, userId: 1 }, { unique: true })
CouponRedemptionSchema.index({ userId: 1 })
