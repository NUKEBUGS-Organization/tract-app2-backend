import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { BidStatus } from '../../../common/enums/bid-status.enum'

export type BidDocument = Bid & Document

@Schema({ timestamps: true, collection: 'bids' })
export class Bid {
  @Prop({
    type: Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true,
  })
  listingId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  buyerId: Types.ObjectId

  @Prop({ required: true, min: 0 })
  assignmentPrice: number

  @Prop({ trim: true, default: '' })
  specialTerms: string

  @Prop({
    type: String,
    enum: Object.values(BidStatus),
    default: BidStatus.ACTIVE,
  })
  status: BidStatus

  @Prop({ type: Number, default: null })
  backupPosition: number | null

  @Prop({ default: false })
  isAboveReserve: boolean

  // Realtor-specific fields
  @Prop({ type: Number, default: null })
  commissionPct: number | null

  @Prop({
    type: String,
    default: null,
    enum: ['buyers_agent', 'transaction_coordinator', null],
  })
  agencyRole: string | null

  @Prop({
    type: String,
    default: null,
    enum: ['seller', 'buyer', null],
  })
  feePaidBy: string | null

  @Prop({ type: Date, default: null })
  submittedAt: Date | null
}

export const BidSchema = SchemaFactory.createForClass(Bid)

BidSchema.index({ listingId: 1, status: 1 })
BidSchema.index({ buyerId: 1, status: 1 })
BidSchema.index({ listingId: 1, buyerId: 1 }, { unique: true })
