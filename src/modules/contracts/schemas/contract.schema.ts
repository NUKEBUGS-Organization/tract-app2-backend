import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'
import { ContractStatus } from '../../../common/enums/contract-status.enum'

export type ContractDocument = Contract & Document

@Schema({ timestamps: true, collection: 'contracts' })
export class Contract {
  @Prop({ type: Types.ObjectId, ref: 'Listing', required: true })
  listingId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Bid', required: true })
  bidId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  wholesalerId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  buyerId: Types.ObjectId

  @Prop({
    type: String,
    enum: Object.values(ContractStatus),
    default: ContractStatus.PENDING,
  })
  status: ContractStatus

  @Prop({ required: true })
  assignmentFeeFinal: number

  @Prop({ type: String, default: null })
  pdfUrl: string | null

  @Prop({ type: String, default: null })
  docusealSubmissionId: string | null

  @Prop({ type: Date, default: null })
  wholesalerSignedAt: Date | null

  @Prop({ type: Date, default: null })
  buyerSignedAt: Date | null

  @Prop({ type: String, default: null })
  docusealWholesalerSubmitterId: string | null

  @Prop({ type: String, default: null })
  docusealBuyerSubmitterId: string | null

  @Prop({ type: String, default: null })
  docusealWholesalerEmbedSrc: string | null

  @Prop({ type: String, default: null })
  docusealBuyerEmbedSrc: string | null

  @Prop({ type: String, default: 'pending' })
  docusealWholesalerStatus: string

  @Prop({ type: String, default: 'pending' })
  docusealBuyerStatus: string

  @Prop({ type: String, default: null })
  signedPdfUrl: string | null

  @Prop({ type: String, default: null })
  auditLogUrl: string | null

  @Prop({ default: false })
  chatUnlocked: boolean

  @Prop({ type: Types.ObjectId, ref: 'TitleCompany', default: null })
  titleCompanyId: Types.ObjectId | null
}

export const ContractSchema = SchemaFactory.createForClass(Contract)

ContractSchema.index({ bidId: 1 }, { unique: true })
ContractSchema.index({ listingId: 1 })
ContractSchema.index({ wholesalerId: 1, buyerId: 1 })
