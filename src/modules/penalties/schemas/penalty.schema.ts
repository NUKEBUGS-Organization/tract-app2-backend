import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Document, Types } from 'mongoose'

export type PenaltyDocument = Penalty & Document

export enum ViolationType {
  FEE_EDIT_POST_ACCEPTANCE = 'fee_edit_post_acceptance',
  BUYER_GHOST_POST_SIGN = 'buyer_ghost_post_sign',
  REALTOR_OFF_PLATFORM = 'realtor_off_platform',
  FAKE_ARV_DOCS = 'fake_arv_docs',
  BAD_FAITH_REVIEW = 'bad_faith_review',
  CONTRACT_DISPUTE = 'contract_dispute',
  MISSED_72HR_DEADLINE = 'missed_72hr_deadline',
  MISSED_INSPECTION = 'missed_inspection',
  GHOSTING = 'ghosting',
}

export enum AutomatedPenalty {
  VOID_DEAL = 'void_deal',
  BAN_30_DAYS = 'ban_30_days',
  DROP_BUYER_RATING = 'drop_buyer_rating',
  FLAG_EMD_FORFEITURE = 'flag_emd_forfeiture',
  PERMANENT_BAN = 'permanent_ban',
  FREEZE_DEAL = 'freeze_deal_tracker',
  STATE_BOARD_LOG = 'state_board_log',
  SUSPENSION_7_DAYS = '7d_suspension',
  SCORE_PENALTY_10 = 'score_penalty_10',
  SCORE_PENALTY_15 = 'score_penalty_15',
  SCORE_PENALTY_20 = 'score_penalty_20',
}

@Schema({ timestamps: true, collection: 'penalties' })
export class Penalty {
  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId: Types.ObjectId

  @Prop({
    type: Types.ObjectId,
    ref: 'Listing',
    default: null,
  })
  listingId: Types.ObjectId | null

  @Prop({
    type: Types.ObjectId,
    ref: 'Deal',
    default: null,
  })
  dealId: Types.ObjectId | null

  @Prop({
    type: String,
    enum: Object.values(ViolationType),
    required: true,
  })
  violationType: ViolationType

  @Prop({
    type: [{ type: String, enum: Object.values(AutomatedPenalty) }],
    default: [],
  })
  automatedPenalties: AutomatedPenalty[]

  @Prop({ default: 0 })
  scoreDeduction: number

  @Prop({ default: false })
  resolved: boolean

  @Prop({
    type: Types.ObjectId,
    ref: 'User',
    default: null,
  })
  resolvedBy: Types.ObjectId | null

  @Prop({ type: Date, default: null })
  resolvedAt: Date | null

  @Prop({ default: '' })
  resolutionNotes: string

  @Prop({ default: false })
  banApplied: boolean

  @Prop({ type: Date, default: null })
  banExpiresAt: Date | null
}

export const PenaltySchema = SchemaFactory.createForClass(Penalty)
