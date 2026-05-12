import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type RatingDocument = Rating & Document

@Schema({ timestamps: true, collection: 'ratings' })
export class Rating {
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
    index: true,
  })
  raterId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  rateeId: Types.ObjectId

  @Prop({ required: true, min: 1, max: 5 })
  stars: number

  @Prop({ default: '', maxlength: 1000 })
  comment: string

  @Prop({ default: false })
  isRetaliatoryFlagged: boolean

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  removedByAdmin: Types.ObjectId | null

  @Prop({ type: Date, default: null })
  removedAt: Date | null
}

export const RatingSchema = SchemaFactory.createForClass(Rating)

// One rating per rater per deal
RatingSchema.index({ dealId: 1, raterId: 1 }, { unique: true })
