import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type UsageCounterDocument = UsageCounter & Document
export type UsageKind = 'listing' | 'bid'

@Schema({ timestamps: true, collection: 'app2_usage_counters' })
export class UsageCounter {
  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId

  @Prop({ required: true, enum: ['listing', 'bid'] })
  kind: UsageKind

  @Prop({ required: true, default: 0 })
  used: number
}

export const UsageCounterSchema = SchemaFactory.createForClass(UsageCounter)
UsageCounterSchema.index({ userId: 1, kind: 1 }, { unique: true })
