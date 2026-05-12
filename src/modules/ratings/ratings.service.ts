import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Rating, RatingDocument } from './schemas/rating.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { CreateRatingDto } from './dto/create-rating.dto'
import { ScoringService } from '../penalties/scoring.service'
import { ViolationType } from '../penalties/schemas/penalty.schema'
import { DealStep } from '../../common/enums/deal-step.enum'

@Injectable()
export class RatingsService {
  private readonly logger = new Logger(RatingsService.name)

  constructor(
    @InjectModel(Rating.name)
    private readonly ratingModel: Model<RatingDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly scoringService: ScoringService,
  ) {}

  async createRating(raterId: string, dto: CreateRatingDto): Promise<RatingDocument> {
    if (!Types.ObjectId.isValid(dto.dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dto.dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    if (deal.currentStep !== DealStep.FUNDED_CLOSED) {
      throw new ForbiddenException('Ratings can only be submitted after the deal is closed.')
    }

    const buyerId = deal.primaryBuyerId.toString()
    const wholesalerId = deal.wholesalerId.toString()

    const isParty = raterId === buyerId || raterId === wholesalerId

    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    const rateeId = raterId === buyerId ? wholesalerId : buyerId

    const existing = await this.ratingModel.findOne({
      dealId: new Types.ObjectId(dto.dealId),
      raterId: new Types.ObjectId(raterId),
    })
    if (existing) {
      throw new ConflictException('You have already submitted a rating for this deal.')
    }

    const rating = await this.ratingModel.create({
      dealId: new Types.ObjectId(dto.dealId),
      raterId: new Types.ObjectId(raterId),
      rateeId: new Types.ObjectId(rateeId),
      stars: dto.stars,
      comment: dto.comment ?? '',
    })

    await this.updateUserRatingStats(rateeId)

    this.logger.log(`Rating submitted: ${dto.stars}★ on deal ${dto.dealId} by ${raterId} for ${rateeId}`)

    return rating
  }

  async getUserRatings(userId: string): Promise<{
    ratings: unknown[]
    averageStars: number
    totalRatings: number
  }> {
    if (!Types.ObjectId.isValid(userId)) {
      return { ratings: [], averageStars: 0, totalRatings: 0 }
    }

    const ratings = await this.ratingModel
      .find({
        rateeId: new Types.ObjectId(userId),
        removedByAdmin: null,
      })
      .populate('raterId', 'fullName role')
      .populate('dealId', 'listingId')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    const totalRatings = ratings.length
    const averageStars =
      totalRatings > 0 ? ratings.reduce((sum, r) => sum + (r as { stars: number }).stars, 0) / totalRatings : 0

    return {
      ratings,
      averageStars: Math.round(averageStars * 10) / 10,
      totalRatings,
    }
  }

  async adminRemoveRating(ratingId: string, adminId: string): Promise<RatingDocument> {
    if (!Types.ObjectId.isValid(ratingId) || !Types.ObjectId.isValid(adminId)) {
      throw new NotFoundException('Rating not found.')
    }

    const rating = await this.ratingModel.findById(ratingId)
    if (!rating) throw new NotFoundException('Rating not found.')

    if (rating.removedByAdmin) {
      throw new ConflictException('Rating already removed.')
    }

    rating.removedByAdmin = new Types.ObjectId(adminId)
    rating.removedAt = new Date()

    await rating.save()

    await this.scoringService.applyViolation(rating.raterId.toString(), ViolationType.BAD_FAITH_REVIEW, {})

    await this.updateUserRatingStats(rating.rateeId.toString())

    this.logger.log(`Rating ${ratingId} removed by admin ${adminId}`)

    return rating
  }

  private async updateUserRatingStats(userId: string): Promise<void> {
    if (!Types.ObjectId.isValid(userId)) return

    const ratings = await this.ratingModel
      .find({
        rateeId: new Types.ObjectId(userId),
        removedByAdmin: null,
      })
      .lean()
      .exec()

    if (ratings.length === 0) {
      await this.userModel.findByIdAndUpdate(userId, { professionalScore: 100 }).exec()
      return
    }

    const avg = ratings.reduce((s, r) => s + r.stars, 0) / ratings.length
    const professionalScore = Math.min(100, Math.round(avg * 20))

    await this.userModel.findByIdAndUpdate(userId, { professionalScore }).exec()
  }
}
