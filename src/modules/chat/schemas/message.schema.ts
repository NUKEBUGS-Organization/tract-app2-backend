import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type MessageDocument = Message & Document

export enum FlagType {
  PHONE_NUMBER = 'phone_number',
  EMAIL_ADDRESS = 'email_address',
  EXTERNAL_LINK = 'external_link',
}

@Schema({ timestamps: true, collection: 'messages' })
export class Message {
  @Prop({
    type: Types.ObjectId,
    ref: 'Deal',
    required: true,
    index: true,
  })
  dealId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  senderId: Types.ObjectId

  @Prop({ required: true, trim: true, maxlength: 5000 })
  content: string

  @Prop({ default: false })
  isFlagged: boolean

  @Prop({
    type: String,
    enum: [...Object.values(FlagType), null],
    default: null,
  })
  flagType: FlagType | null

  @Prop({ default: false })
  isBlocked: boolean

  @Prop({ type: String, default: null })
  blockedReason: string | null

  @Prop({ type: Date, default: null })
  readAt: Date | null

  @Prop({ default: false })
  isSystemMessage: boolean
}

export const MessageSchema = SchemaFactory.createForClass(Message)

MessageSchema.index({ dealId: 1, createdAt: 1 })
