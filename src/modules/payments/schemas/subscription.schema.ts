import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type SubscriptionDocument = Subscription & Document

@Schema({ timestamps: true, collection: 'app2_subscriptions' })
export class Subscription {
  @Prop({ type: Types.ObjectId, required: true, unique: true, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true })
  amount: number

  @Prop({ required: true })
  planId: string

  @Prop({ required: true })
  requestId: string

  @Prop({ type: String, default: null })
  paypalSubscriptionId: string | null

  @Prop({ default: 'CREATING' })
  status: string

  @Prop({ type: String, default: null })
  approvalUrl: string | null

  @Prop({ type: Date, default: null })
  paidUntil: Date | null

  @Prop({ type: Date, default: null })
  lastPaymentAt: Date | null

  @Prop({ type: Date, default: null })
  revokedPaymentAt: Date | null

  @Prop({ type: Date, default: null })
  syncedAt: Date | null

  @Prop({ type: Date, required: true })
  termsAcceptedAt: Date

  @Prop({ required: true })
  termsVersion: string
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription)
SubscriptionSchema.index({ paypalSubscriptionId: 1 }, { unique: true, partialFilterExpression: { paypalSubscriptionId: { $type: 'string' } } })
