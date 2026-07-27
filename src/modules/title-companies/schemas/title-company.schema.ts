import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'

export type TitleCompanyDocument = TitleCompany & Document

@Schema({ timestamps: true, collection: 'title_companies' })
export class TitleCompany {
  @Prop({ required: true, trim: true })
  name: string

  @Prop({ required: true, trim: true, lowercase: true })
  contactEmail: string

  @Prop({ type: String, default: '', trim: true })
  phone: string

  @Prop({ default: true })
  active: boolean
}

export const TitleCompanySchema = SchemaFactory.createForClass(TitleCompany)
TitleCompanySchema.index({ active: 1, name: 1 })
TitleCompanySchema.index({ name: 1 }, { unique: true })
