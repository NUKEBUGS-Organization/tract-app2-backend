import { Prop, Schema, SchemaFactory }
  from '@nestjs/mongoose'
import { Document } from 'mongoose'
import { FAQ_CATEGORIES }
  from '../../../common/constants/faq-categories'

export type FaqDocument = Faq & Document

@Schema({ timestamps: true, collection: 'faqs' })
export class Faq {
  @Prop({
    required: true,
    trim: true,
    maxlength: 500,
  })
  question: string

  @Prop({
    required: true,
    trim: true,
    maxlength: 10000,
  })
  answer: string

  @Prop({
    required: true,
    trim: true,
    maxlength: 100,
    default: 'General',
    enum: FAQ_CATEGORIES,
  })
  category: string

  @Prop({
    required: true,
    unique: true,
    trim: true,
    maxlength: 120,
  })
  slug: string

  @Prop({ required: true, default: 0 })
  order: number

  @Prop({ required: true, default: false })
  isPublished: boolean
}

export const FaqSchema =
  SchemaFactory.createForClass(Faq)

FaqSchema.index({ category: 1, order: 1 })
FaqSchema.index({ slug: 1 }, { unique: true })
FaqSchema.index({ isPublished: 1 })
