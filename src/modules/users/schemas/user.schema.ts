import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'
import { UserRole }  from '../../../common/enums/user-role.enum'
import { KycStatus } from '../../../common/enums/kyc-status.enum'

export type UserDocument = User & Document

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  fullName: string

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string

  @Prop({ required: true })
  phone: string

  @Prop({ required: true, select: false })
  password: string

  @Prop({ required: true, type: String, enum: Object.values(UserRole) })
  role: UserRole

  @Prop({ required: true })
  stateCode: string

  @Prop({ required: true })
  dob: Date

  @Prop({ type: String, enum: Object.values(KycStatus), default: KycStatus.PENDING })
  kycStatus: KycStatus

  @Prop({ default: false })
  bankVerified: boolean

  @Prop({ default: 100, min: 0, max: 100 })
  reliabilityScore: number

  @Prop({ default: 100, min: 0, max: 100 })
  professionalScore: number

  @Prop({ default: 0 })
  activeDealsCount: number

  @Prop({ default: 0 })
  totalDealsClosed: number

  @Prop({ default: false })
  isBanned: boolean

  @Prop({ default: null })
  banReason: string

  @Prop({ type: String, default: null })
  refreshToken: string | null

  @Prop({ default: null })
  lastActiveAt: Date

  @Prop({ default: null })
  scoreRestrictedUntil: Date
}

export const UserSchema = SchemaFactory.createForClass(User)
