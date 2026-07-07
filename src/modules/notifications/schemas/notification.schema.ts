import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type NotificationDocument = Notification & Document

export enum NotificationChannel {
  PUSH = 'push',
  EMAIL = 'email',
  SMS = 'sms',
  IN_APP = 'in_app',
}

export enum NotificationType {
  BID_RECEIVED = 'bid_received',
  TIMER_WARNING = 'timer_warning',
  KILL_SWITCH = 'kill_switch',
  CHAT_UNLOCKED = 'chat_unlocked',
  SCORE_PENALTY = 'score_penalty',
  CONTRACT_READY = 'contract_ready',
  DEAL_CANCELLED = 'deal_cancelled',
  DEAL_CLOSED = 'deal_closed',
  TICKET_CREATED = 'ticket_created',
  TICKET_REPLY = 'ticket_reply',
  TICKET_RESOLVED = 'ticket_resolved',
}

@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Deal', default: null })
  dealId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Listing', default: null })
  listingId: Types.ObjectId

  @Prop({ required: true, enum: Object.values(NotificationChannel) })
  channel: NotificationChannel

  @Prop({ required: true })
  title: string

  @Prop({ required: true })
  body: string

  @Prop({ required: true, enum: Object.values(NotificationType) })
  type: NotificationType

  @Prop({ default: false })
  isRead: boolean

  @Prop({ default: null })
  readAt: Date | null
}

export const NotificationSchema = SchemaFactory.createForClass(Notification)

NotificationSchema.index({ userId: 1, createdAt: -1 })
