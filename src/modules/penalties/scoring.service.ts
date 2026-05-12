import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { User, UserDocument } from '../users/schemas/user.schema'
import {
  Penalty,
  PenaltyDocument,
  ViolationType,
  AutomatedPenalty,
} from './schemas/penalty.schema'

const PENALTY_MATRIX: Record<
  ViolationType,
  {
    scoreDeduction: number
    penalties: AutomatedPenalty[]
    ban?: number
  }
> = {
  [ViolationType.FEE_EDIT_POST_ACCEPTANCE]: {
    scoreDeduction: 0,
    penalties: [AutomatedPenalty.VOID_DEAL, AutomatedPenalty.BAN_30_DAYS],
    ban: 30,
  },
  [ViolationType.BUYER_GHOST_POST_SIGN]: {
    scoreDeduction: 10,
    penalties: [AutomatedPenalty.DROP_BUYER_RATING, AutomatedPenalty.FLAG_EMD_FORFEITURE],
  },
  [ViolationType.REALTOR_OFF_PLATFORM]: {
    scoreDeduction: 0,
    penalties: [AutomatedPenalty.PERMANENT_BAN],
    ban: 0,
  },
  [ViolationType.FAKE_ARV_DOCS]: {
    scoreDeduction: 0,
    penalties: [AutomatedPenalty.PERMANENT_BAN, AutomatedPenalty.STATE_BOARD_LOG],
    ban: 0,
  },
  [ViolationType.BAD_FAITH_REVIEW]: {
    scoreDeduction: 0,
    penalties: [AutomatedPenalty.SUSPENSION_7_DAYS],
    ban: 7,
  },
  [ViolationType.CONTRACT_DISPUTE]: {
    scoreDeduction: 0,
    penalties: [AutomatedPenalty.FREEZE_DEAL],
  },
  [ViolationType.MISSED_72HR_DEADLINE]: {
    scoreDeduction: 15,
    penalties: [AutomatedPenalty.SCORE_PENALTY_15],
  },
  [ViolationType.MISSED_INSPECTION]: {
    scoreDeduction: 20,
    penalties: [AutomatedPenalty.SCORE_PENALTY_20],
  },
  [ViolationType.GHOSTING]: {
    scoreDeduction: 10,
    penalties: [AutomatedPenalty.SCORE_PENALTY_10],
  },
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Penalty.name)
    private readonly penaltyModel: Model<PenaltyDocument>,
  ) {}

  async applyViolation(
    userId: string,
    violationType: ViolationType,
    context: {
      dealId?: string
      listingId?: string
      notes?: string
    } = {},
  ): Promise<PenaltyDocument> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id.')
    }

    const matrix = PENALTY_MATRIX[violationType]
    if (!matrix) {
      throw new BadRequestException(`Unknown violation type: ${violationType}`)
    }

    const user = await this.userModel.findById(userId)
    if (!user) {
      throw new NotFoundException(`User ${userId} not found for penalty.`)
    }

    let banApplied = false
    let banExpiresAt: Date | null = null

    if (matrix.scoreDeduction > 0) {
      const newScore = Math.max(0, user.reliabilityScore - matrix.scoreDeduction)
      user.reliabilityScore = newScore

      if (newScore < 30) {
        user.isBanned = true
        user.banReason = 'Reliability score below 30'
        banApplied = true
        this.logger.warn(`User ${userId} permanently banned — score dropped to ${newScore}`)
      }
    }

    if (matrix.ban !== undefined) {
      user.isBanned = true
      if (matrix.ban === 0) {
        user.banReason = `Permanent ban: ${violationType}`
        banApplied = true
        this.logger.warn(`User ${userId} permanently banned: ${violationType}`)
      } else {
        banExpiresAt = new Date(Date.now() + matrix.ban * 24 * 60 * 60 * 1000)
        user.banReason = `Temporary ban: ${violationType}`
        banApplied = true
        this.logger.warn(`User ${userId} banned for ${matrix.ban} days: ${violationType}`)
      }
    }

    await user.save()

    const penalty = await this.penaltyModel.create({
      userId: new Types.ObjectId(userId),
      dealId: context.dealId ? new Types.ObjectId(context.dealId) : null,
      listingId: context.listingId ? new Types.ObjectId(context.listingId) : null,
      violationType,
      automatedPenalties: matrix.penalties,
      scoreDeduction: matrix.scoreDeduction,
      banApplied,
      banExpiresAt,
      resolutionNotes: context.notes ?? '',
    })

    this.logger.log(`Penalty applied: ${violationType} on user ${userId} (-${matrix.scoreDeduction} score)`)

    return penalty
  }

  async rewardSuccessfulClose(userId: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $inc: {
          app2_totalDealsClosed: 1,
          app2_activeDealsCount: -1,
        },
        $set: {
          app2_lastContractSecuredAt: new Date(),
        },
      })
      this.logger.log(`Successful close recorded for user ${userId}`)
    } catch (err) {
      this.logger.error(`rewardSuccessfulClose failed for ${userId}:`, err)
      // Non-critical — don't throw
    }
  }

  async getUserScore(userId: string): Promise<{
    reliabilityScore: number
    professionalScore: number
    tier: string
    app2_activeDeals: number
    app2_totalClosed: number
    penalties: PenaltyDocument[]
  }> {
    try {
      const user = await this.userModel.findById(userId)
      if (!user) throw new NotFoundException(`User ${userId} not found.`)

      const penalties = await this.penaltyModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean()
        .exec()

      const score = user.reliabilityScore
      let tier = 'Elite'
      if (score < 30) tier = 'Banned'
      else if (score < 50) tier = 'Restricted'
      else if (score < 70) tier = 'At Risk'
      else if (score < 85) tier = 'Good Standing'

      return {
        reliabilityScore: score,
        professionalScore: user.professionalScore,
        tier,
        app2_activeDeals: user.app2_activeDealsCount,
        app2_totalClosed: user.app2_totalDealsClosed,
        penalties: penalties as PenaltyDocument[],
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error(`getUserScore failed for ${userId}:`, err)
      throw new InternalServerErrorException('Failed to fetch score data.')
    }
  }

  async isRestricted(userId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(userId)) return true
    const user = await this.userModel.findById(userId)
    if (!user) return true
    if (user.isBanned) return true
    if (user.reliabilityScore < 50) return true
    if (user.scoreRestrictedUntil && new Date() < user.scoreRestrictedUntil) return true
    return false
  }
}
