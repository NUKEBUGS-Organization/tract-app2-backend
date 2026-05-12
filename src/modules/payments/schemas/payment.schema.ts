import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type PaymentDocument = Payment & Document

@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ type: Types.ObjectId, ref: 'User',  required: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null })
  dealId: Types.ObjectId

  @Prop({ required: true,
    enum: ['platform_fee','reactivation_fee','subscription'] })
  paymentType: string

  @Prop({ required: true, min: 0 })
  amount: number

  @Prop({ default: 'USD' })
  currency: string

  @Prop({ default: null })
  stripePaymentIntentId: string

  @Prop({ default: 'pending',
    enum: ['pending','succeeded','failed','refunded'] })
  status: string

  @Prop({ default: null })
  failureReason: string

  @Prop({ default: null })
  processedAt: Date
}

export const PaymentSchema = SchemaFactory.createForClass(Payment)
