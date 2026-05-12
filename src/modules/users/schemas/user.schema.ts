import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document } from 'mongoose'
import { UserRole } from '../../../common/enums/user-role.enum'

export type UserDocument = User & Document

@Schema({
  timestamps: true,
  collection: 'users', // shared with App 1
})
export class User {
  // ══════════════════════════════════════
  // SHARED — Identity
  // ══════════════════════════════════════

  @Prop({ required: true, trim: true })
  fullName: string

  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  })
  email: string

  @Prop({ required: true, select: false })
  password: string

  @Prop({ required: true })
  phone: string

  @Prop({
    type: String,
    enum: Object.values(UserRole),
    required: true,
  })
  role: UserRole

  @Prop({ uppercase: true, trim: true, default: '' })
  stateCode: string

  @Prop({ type: Date, default: null })
  dob: Date | null

  // ══════════════════════════════════════
  // SHARED — KYC & Verification
  // Verified once, valid on both apps
  // ══════════════════════════════════════

  @Prop({
    type: String,
    default: 'pending',
    enum: ['pending', 'in_progress', 'approved', 'rejected'],
  })
  kycStatus: string

  @Prop({ type: Date, default: null })
  kycVerifiedAt: Date | null

  @Prop({ type: String, default: null })
  kycProvider: string | null

  @Prop({ default: false })
  bankVerified: boolean

  @Prop({ type: Date, default: null })
  bankVerifiedAt: Date | null

  @Prop({ type: String, default: null })
  bankProvider: string | null

  // ══════════════════════════════════════
  // SHARED — Auth
  // ══════════════════════════════════════

  @Prop({ type: String, default: null, select: false })
  refreshToken: string | null

  @Prop({ type: Date, default: null })
  lastActiveAt: Date | null

  // ══════════════════════════════════════
  // SHARED — Scores
  // Follow user across both apps
  // ══════════════════════════════════════

  @Prop({ default: 100, min: 0, max: 100 })
  reliabilityScore: number

  @Prop({ default: 100, min: 0, max: 100 })
  professionalScore: number

  // ══════════════════════════════════════
  // SHARED — Bans & Restrictions
  // Ban on one app = ban on both
  // ══════════════════════════════════════

  @Prop({ default: false })
  isBanned: boolean

  @Prop({ type: String, default: null })
  banReason: string | null

  @Prop({ type: Date, default: null })
  banExpiresAt: Date | null

  @Prop({ type: Date, default: null })
  scoreRestrictedUntil: Date | null

  // ══════════════════════════════════════
  // SHARED — Realtor Credentials
  // Same license on both apps
  // ══════════════════════════════════════

  @Prop({ default: '' })
  licenseNumber: string

  @Prop({ default: '' })
  brokerageName: string

  @Prop({ default: '' })
  managingBroker: string

  @Prop({ default: '' })
  officeAddress: string

  @Prop({ default: 0, min: 0, max: 100 })
  commissionPct: number

  @Prop({
    type: String,
    default: null,
    enum: ['buyers_agent', 'transaction_coordinator', null],
  })
  defaultAgencyRole: string | null

  @Prop({
    type: String,
    default: null,
    enum: ['seller', 'buyer', null],
  })
  defaultFeePaidBy: string | null

  // ══════════════════════════════════════
  // SHARED — Professional Proof
  // Verified once, used on both apps
  // ══════════════════════════════════════

  @Prop({ type: String, default: null })
  proofOfActivityUrl: string | null

  @Prop({ type: Date, default: null })
  proofOfActivityUploadedAt: Date | null

  @Prop({ default: '' })
  linkedInUrl: string

  // ══════════════════════════════════════
  // APP 2 SPECIFIC
  // Prefix: app2_
  // App 1 ignores these fields entirely
  // ══════════════════════════════════════

  // Vetted buyer (App 2 admin approves)
  @Prop({ default: false })
  app2_isVettedBuyer: boolean

  @Prop({ type: Date, default: null })
  app2_vettedAt: Date | null

  // App 2 deal tracking (separate from App 1)
  @Prop({ default: 0 })
  app2_activeDealsCount: number

  @Prop({ default: 0 })
  app2_totalDealsClosed: number

  @Prop({ type: Date, default: null })
  app2_lastContractSecuredAt: Date | null

  // 30-day activity rule (App 2)
  @Prop({ default: false })
  app2_reactivationFeePending: boolean

  // Platform fee tracking (App 2)
  @Prop({ default: false })
  app2_platformFeePaid: boolean

  @Prop({ default: 0 })
  app2_totalPlatformFeesPaid: number

  // ══════════════════════════════════════
  // APP 1 SPECIFIC
  // Prefix: app1_
  // App 2 ignores these fields entirely
  // These exist here so Mongoose never
  // rejects App 1 user documents
  // ══════════════════════════════════════

  @Prop({ default: false })
  app1_inRestrictedState: boolean

  @Prop({ default: 0 })
  app1_activeDealsCount: number

  @Prop({ default: 0 })
  app1_totalDealsClosed: number

  @Prop({ type: Date, default: null })
  app1_lastContractSecuredAt: Date | null

  @Prop({ default: 1 })
  app1_maxActiveDeals: number

  @Prop({ default: false })
  app1_reactivationFeePending: boolean

  @Prop({ default: false })
  app1_platformFeePaid: boolean

  @Prop({ default: 0 })
  app1_totalPlatformFeesPaid: number

  // App 1 → App 2 bridge reference
  @Prop({ type: String, default: null })
  app1_linkedUserId: string | null
}

export const UserSchema = SchemaFactory.createForClass(User)

// ── Indexes ──────────────────────────────────────
UserSchema.index({ email: 1 }, { unique: true })
UserSchema.index({ role: 1, isBanned: 1 })
UserSchema.index({ stateCode: 1, role: 1 })
UserSchema.index({ reliabilityScore: 1 })
UserSchema.index({ kycStatus: 1 })
