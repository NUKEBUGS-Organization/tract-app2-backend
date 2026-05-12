import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { ListingStatus } from '../../../common/enums/listing-status.enum'
import { DealType } from '../../../common/enums/deal-type.enum'

export type ListingDocument = Listing & Document

@Schema({ timestamps: true, collection: 'listings' })
export class Listing {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  wholesalerId: Types.ObjectId

  @Prop({ type: String, enum: Object.values(ListingStatus), default: ListingStatus.DRAFT })
  status: ListingStatus

  @Prop({ trim: true, default: '' })
  propertyAddress: string

  @Prop({ trim: true, default: '' })
  city: string

  @Prop({ uppercase: true, trim: true, default: '' })
  stateCode: string

  @Prop({ trim: true, default: '' })
  zipCode: string

  @Prop({ required: true, type: String, enum: Object.values(DealType) })
  dealType: DealType

  @Prop({ default: 'off_market', enum: ['off_market', 'on_market'] })
  marketStatus: string

  // Financial fields
  @Prop({ default: 0, min: 0 })
  arv: number

  @Prop({ type: Object, default: {} })
  rehabBreakdown: Record<string, number>

  @Prop({ default: 0, min: 0 })
  rehabTotal: number

  @Prop({ default: 0, min: 0 })
  purchasePrice: number

  @Prop({ default: 0, min: 0 })
  estimatedHoldingCosts: number

  @Prop({ default: 0 })
  projectedBuyerProfit: number

  // Assignment fees
  @Prop({ default: 0, min: 0, select: false })
  assignmentFeeLow: number // backend only — never sent to buyers

  @Prop({ default: 0, min: 0 })
  assignmentFeeHigh: number // publicly visible

  // Compliance
  @Prop({ default: false })
  feeLocked: boolean

  @Prop({ default: false })
  outlierFlagged: boolean

  @Prop({ type: Date, default: null })
  complianceScannedAt: Date | null

  @Prop({ type: Date, default: null })
  publishedAt: Date | null

  // Bidding
  @Prop({ default: 0, min: 0, max: 10 })
  bidCount: number

  @Prop({ default: true })
  bidsOpen: boolean

  // Media
  @Prop({ type: [String], default: [] })
  photoUrls: string[]

  @Prop({ default: '' })
  videoUrl: string

  // App 1 bridge
  @Prop({ type: Types.ObjectId, ref: 'Contract', default: null })
  app1ContractId: Types.ObjectId | null

  @Prop({ type: Types.ObjectId, ref: 'Listing', default: null })
  app1PropertyId: Types.ObjectId | null
}

export const ListingSchema = SchemaFactory.createForClass(Listing)

// Indexes for performance
ListingSchema.index({ status: 1, stateCode: 1 })
ListingSchema.index({ wholesalerId: 1, status: 1 })
ListingSchema.index({ bidCount: 1, bidsOpen: 1 })
