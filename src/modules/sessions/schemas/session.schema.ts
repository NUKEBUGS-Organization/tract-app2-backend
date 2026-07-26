import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type SessionDocument = Session & Document

@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId

  @Prop({ required: true })
  sessionId: string

  @Prop({ required: true })
  refreshTokenHash: string

  @Prop({ default: false })
  isBlacklisted: boolean

  /** When the session was rotated/revoked — used for concurrent refresh grace. */
  @Prop({ type: Date, default: null })
  blacklistedAt: Date | null

  /** Session that superseded this one after rotation (if any). */
  @Prop({ type: String, default: null })
  rotatedTo: string | null

  @Prop({ required: true })
  expiresAt: Date

  @Prop({ type: Date, default: null })
  deletedAt: Date | null
}

export const SessionSchema = SchemaFactory.createForClass(Session)
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })
SessionSchema.index({ sessionId: 1 })
SessionSchema.index({ userId: 1, isBlacklisted: 1 })
