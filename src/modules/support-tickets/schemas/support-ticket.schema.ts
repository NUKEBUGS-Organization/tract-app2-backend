import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { UserRole } from '../../../common/enums/user-role.enum'

export type SupportTicketDocument = SupportTicket & Document

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum TicketPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Schema({ _id: false })
export class TicketMessage {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId

  @Prop({ required: true, enum: Object.values(UserRole) })
  senderRole: UserRole

  @Prop({ required: true, trim: true, maxlength: 10000 })
  body: string

  @Prop({ type: Date, default: () => new Date() })
  createdAt: Date
}

export const TicketMessageSchema = SchemaFactory.createForClass(TicketMessage)

@Schema({ timestamps: true, collection: 'support_tickets' })
export class SupportTicket {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId

  @Prop({ required: true, enum: Object.values(UserRole) })
  userRole: UserRole

  @Prop({ required: true, trim: true, maxlength: 200 })
  subject: string

  @Prop({ required: true, trim: true, maxlength: 10000 })
  description: string

  @Prop({
    required: true,
    enum: Object.values(TicketStatus),
    default: TicketStatus.OPEN,
    index: true,
  })
  status: TicketStatus

  @Prop({
    required: true,
    enum: Object.values(TicketPriority),
    default: TicketPriority.MEDIUM,
  })
  priority: TicketPriority

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedTo: Types.ObjectId | null

  @Prop({ type: [TicketMessageSchema], default: [] })
  messages: TicketMessage[]
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket)

SupportTicketSchema.index({ userId: 1, createdAt: -1 })
SupportTicketSchema.index({ status: 1, createdAt: -1 })
