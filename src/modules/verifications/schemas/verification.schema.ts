import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type VerificationDocument = Verification & Document

export enum VerificationType {
  REALTOR = 'realtor',
  WHOLESALER = 'wholesaler',
}

export enum VerificationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/** Shared with App1 — keep field names aligned with App1 Verification schema. */
@Schema({ timestamps: true })
export class Verification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  user_id: Types.ObjectId

  @Prop({ type: String, enum: VerificationType, required: true })
  type: VerificationType

  @Prop({
    type: String,
    enum: VerificationStatus,
    default: VerificationStatus.PENDING,
  })
  status: VerificationStatus

  @Prop({ default: null })
  state_license_number: string

  @Prop({ default: null })
  brokerage_name: string

  @Prop({ default: null })
  managing_broker: string

  @Prop({ default: null })
  office_address: string

  @Prop({ default: null })
  document_url: string

  @Prop({ default: null })
  document_public_id: string

  @Prop({ default: null })
  document_file_name: string

  @Prop({ default: null })
  rejection_reason: string

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewed_by: Types.ObjectId

  @Prop({ default: null })
  reviewed_at: Date

  @Prop({ default: Date.now })
  submitted_at: Date
}

export const VerificationSchema = SchemaFactory.createForClass(Verification)
