import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type VaultDocumentDocument = VaultDocument & Document

@Schema({ timestamps: true })
export class VaultDocument {
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
  })
  uploadedBy: Types.ObjectId

  @Prop({ required: true })
  fileName: string

  @Prop({ required: true })
  fileUrl: string

  @Prop({ default: 'document' })
  fileType: string

  @Prop({ default: 'all' })
  visibleTo: string

  @Prop({ default: false })
  isDeleted: boolean
}

export const VaultDocumentSchema = SchemaFactory.createForClass(VaultDocument)
