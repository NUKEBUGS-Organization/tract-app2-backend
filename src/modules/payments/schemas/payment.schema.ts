import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type PaymentDocument = Payment & Document

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Deal', required: true, index: true })
  dealId: Types.ObjectId

  @Prop({
    required: true,
    enum: ['platform_fee', 'reactivation_fee', 'subscription'],
  })
  paymentType: string

  /** Which deal party this fee belongs to. */
  @Prop({ required: true, enum: ['buyer', 'wholesaler'] })
  party: string

  @Prop({ required: true, min: 0 })
  amount: number

  @Prop({ default: 'USD' })
  currency: string

  @Prop({ type: String, default: null })
  paypalOrderId: string | null

  @Prop({ type: String, default: null })
  paypalCaptureId: string | null

  @Prop({
    default: 'pending',
    enum: ['pending', 'succeeded', 'failed', 'refunded'],
  })
  status: string

  @Prop({ type: String, default: null })
  failureReason: string | null

  @Prop({ type: Date, default: null })
  processedAt: Date | null
}

export const PaymentSchema = SchemaFactory.createForClass(Payment)

PaymentSchema.index(
  { dealId: 1, party: 1, paymentType: 1 },
  { unique: true },
)
PaymentSchema.index({ paypalOrderId: 1 }, { sparse: true })
