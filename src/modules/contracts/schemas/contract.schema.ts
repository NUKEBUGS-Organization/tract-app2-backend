import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type ContractDocument = Contract & Document

@Schema({ timestamps: true, collection: 'contracts' })
export class Contract {
  @Prop({ type: Types.ObjectId, ref: 'Listing',  required: true })
  listingId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'Bid',      required: true })
  bidId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User',     required: true })
  wholesalerId: Types.ObjectId

  @Prop({ type: Types.ObjectId, ref: 'User',     required: true })
  buyerId: Types.ObjectId

  @Prop({ default: 'pending_buyer_signature',
    enum: ['pending_buyer_signature','signed','buyer_failed','cancelled','closed'] })
  status: string

  @Prop({ required: true })
  assignmentFeeFinal: number

  @Prop({ default: null })
  pdfS3Key: string

  @Prop({ default: null })
  docusignEnvelopeId: string

  @Prop({ default: null })
  wholesalerSignedAt: Date

  @Prop({ default: null })
  buyerSignedAt: Date

  @Prop({ default: false })
  chatUnlocked: boolean

  @Prop({ type: Types.ObjectId, ref: 'TitleCompany', default: null })
  titleCompanyId: Types.ObjectId
}

export const ContractSchema = SchemaFactory.createForClass(Contract)
