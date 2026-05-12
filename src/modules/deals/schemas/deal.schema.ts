import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { DealStep } from '../../../common/enums/deal-step.enum'

export type DealDocument = Deal & Document

@Schema({ timestamps: true, collection: 'deals' })
export class Deal {
  @Prop({
    type: Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true,
  })
  listingId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'Bid',
    required: true,
  })
  primaryBidId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  primaryBuyerId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  wholesalerId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  titleRepId: Types.ObjectId | null

  @Prop({
    type: String,
    enum: Object.values(DealStep),
    default: DealStep.CONTRACT_SIGNED,
  })
  currentStep: DealStep

  // Timeline
  @Prop({ type: Date, default: null })
  contractSignedAt: Date | null

  @Prop({ type: Date, default: null })
  emdDepositedAt: Date | null

  @Prop({ type: Date, default: null })
  inspectionCompletedAt: Date | null

  @Prop({ type: Date, default: null })
  appraisalOrderedAt: Date | null

  @Prop({ type: Date, default: null })
  financingApprovedAt: Date | null

  @Prop({ type: Date, default: null })
  titleSearchCompleteAt: Date | null

  @Prop({ type: Date, default: null })
  clearToCloseAt: Date | null

  @Prop({ type: Date, default: null })
  closedAt: Date | null

  // Kill switch — 72-hour marketing proof deadline
  @Prop({ type: Date, default: null })
  marketingProofDeadline: Date | null

  @Prop({ default: false })
  marketingProofUploaded: boolean

  @Prop({ default: false })
  killSwitchFired: boolean

  @Prop({ type: String, default: null })
  marketingProofUrl: string | null

  // EMD
  @Prop({ default: 0 })
  emdAmount: number

  @Prop({
    type: String,
    default: 'pending',
    enum: ['pending', 'deposited', 'forfeited', 'returned'],
  })
  emdStatus: string

  // Buyer failure
  @Prop({ default: false })
  buyerFailed: boolean

  @Prop({
    type: String,
    default: null,
    enum: ['financing_dropped', 'walked_away', 'failed_inspection', null],
  })
  buyerFailedReason: string | null

  @Prop({ type: Date, default: null })
  buyerFailedAt: Date | null

  @Prop({ default: false })
  emdForfeited: boolean

  // Backup promotion
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  backup2BuyerId: Types.ObjectId | null

  @Prop({
    type: Types.ObjectId,
    ref: 'Bid',
    default: null,
  })
  backup2BidId: Types.ObjectId | null

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  backup3BuyerId: Types.ObjectId | null

  @Prop({
    type: Types.ObjectId,
    ref: 'Bid',
    default: null,
  })
  backup3BidId: Types.ObjectId | null

  @Prop({ type: Date, default: null })
  backupActivationDeadline: Date | null

  // Dispute
  @Prop({ default: false })
  disputeFrozen: boolean

  @Prop({ type: Date, default: null })
  disputeInitiatedAt: Date | null

  // Title company
  @Prop({ default: '' })
  titleCompanyName: string

  @Prop({ default: '' })
  titleCompanyEmail: string

  @Prop({ default: '' })
  emdWiringInstructions: string
}

export const DealSchema = SchemaFactory.createForClass(Deal)

DealSchema.index({ listingId: 1, primaryBuyerId: 1 })
DealSchema.index({ wholesalerId: 1, currentStep: 1 })
