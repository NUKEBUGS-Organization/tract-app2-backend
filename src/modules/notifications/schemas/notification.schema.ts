import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NotificationDocument = Notification & Document

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User',    required: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Deal',    default: null })
  dealId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Listing', default: null })
  listingId: Types.ObjectId

  @Prop({ required: true,
    enum: ['push','email','sms','in_app'] })
  channel: string

  @Prop({ required: true })
  title: string

  @Prop({ required: true })
  body: string

  @Prop({ required: true,
    enum: [
      'bid_received',
      'timer_warning',
      'kill_switch',
      'chat_unlocked',
      'score_penalty',
      'contract_ready',
      'deal_cancelled',
      'deal_closed',
    ]})
  type: string

  @Prop({ default: false })
  isRead: boolean

  @Prop({ default: null })
  readAt: Date
}

export const NotificationSchema = SchemaFactory.createForClass(Notification)
