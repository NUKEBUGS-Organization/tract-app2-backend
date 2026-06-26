import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Deal, DealDocument } from './schemas/deal.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { CreateDealDto } from './dto/create-deal.dto'
import { AdvanceStepDto } from './dto/advance-step.dto'
import { BuyerFailedDto } from './dto/buyer-failed.dto'
import { TitleCompanyDto } from './dto/title-company.dto'
import { DealStep, STEP_ORDER, TITLE_REP_STEPS } from '../../common/enums/deal-step.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { JobsService } from '../jobs/jobs.service'
import { AppGateway } from '../gateway/app.gateway'
import { SOCKET_EVENTS } from '../gateway/socket-events.constants'

function refId(ref: unknown): string | null {
  if (ref == null) return null
  if (typeof ref === 'object' && '_id' in (ref as object)) {
    return String((ref as { _id: Types.ObjectId })._id)
  }
  return String(ref)
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name)

  constructor(
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Bid.name)
    private readonly bidModel: Model<BidDocument>,
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly jobsService: JobsService,
    private readonly gateway: AppGateway,
  ) {}

  private async autoAssignTitleRep(): Promise<Types.ObjectId | null> {
    try {
      const titleReps = await this.userModel
        .find({
          role: UserRole.TITLE_REP,
          kycStatus: 'approved',
          isBanned: { $ne: true },
        })
        .select('_id')
        .lean()
        .exec()

      if (!titleReps.length) {
        this.logger.warn('No approved title reps available for auto-assignment.')
        return null
      }

      const dealCounts = await this.dealModel
        .aggregate([
          {
            $match: {
              titleRepId: { $in: titleReps.map((r) => r._id) },
              currentStep: { $nin: ['funded_closed'] },
            },
          },
          {
            $group: {
              _id: '$titleRepId',
              dealCount: { $sum: 1 },
            },
          },
        ])
        .exec()

      const countMap = new Map<string, number>()
      for (const { _id, dealCount } of dealCounts) {
        countMap.set(_id.toString(), dealCount)
      }

      let leastBusy = titleReps[0]
      let leastCount = countMap.get(leastBusy._id.toString()) ?? 0

      for (const rep of titleReps.slice(1)) {
        const count = countMap.get(rep._id.toString()) ?? 0
        if (count < leastCount) {
          leastBusy = rep
          leastCount = count
        }
      }

      this.logger.log(`Auto-assigned title rep ${leastBusy._id} (${leastCount} active deals)`)

      return new Types.ObjectId(leastBusy._id.toString())
    } catch (err) {
      this.logger.error('Auto-assign title rep failed:', err)
      return null
    }
  }

  // ── Create deal after bid selection ──────────────────────────
  async createDeal(
    dto: CreateDealDto,
    actorId: string,
    role: string,
  ): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dto.listingId)) {
      throw new BadRequestException('Invalid listingId.')
    }
    if (!Types.ObjectId.isValid(dto.primaryBidId) || !Types.ObjectId.isValid(dto.primaryBuyerId)) {
      throw new BadRequestException('Invalid primaryBidId or primaryBuyerId.')
    }
    if (!Types.ObjectId.isValid(dto.wholesalerId)) {
      throw new BadRequestException('Invalid wholesalerId.')
    }

    if (role !== UserRole.ADMIN && dto.wholesalerId !== actorId) {
      throw new ForbiddenException('wholesalerId must match the authenticated wholesaler.')
    }

    const now = new Date()
    const deadline = new Date(now.getTime() + 72 * 60 * 60 * 1000)

    const titleRepId = await this.autoAssignTitleRep()

    const deal = await this.dealModel.create({
      listingId: new Types.ObjectId(dto.listingId),
      primaryBidId: new Types.ObjectId(dto.primaryBidId),
      primaryBuyerId: new Types.ObjectId(dto.primaryBuyerId),
      wholesalerId: new Types.ObjectId(dto.wholesalerId),
      titleRepId,
      currentStep: DealStep.CONTRACT_SIGNED,
      contractSignedAt: now,
      marketingProofDeadline: deadline,
      emdAmount: dto.emdAmount ?? 0,
      emdStatus: 'pending',
    })

    this.logger.log(`Deal created: ${deal._id} for listing ${dto.listingId}`)

    if (deal.marketingProofDeadline) {
      await this.jobsService.schedule72hrCheck(deal._id.toString(), deal.marketingProofDeadline)
    }

    return deal
  }

  // ── Get single deal ───────────────────────────────────────────
  async findOne(dealId: string, userId: string, role: string): Promise<unknown> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel
      .findById(dealId)
      .populate('listingId', 'propertyAddress city stateCode dealType arv')
      .populate('primaryBuyerId', 'fullName reliabilityScore')
      .populate('wholesalerId', 'fullName reliabilityScore')
      .populate('titleRepId', 'fullName email')
      .lean()
      .exec()

    if (!deal) throw new NotFoundException('Deal not found.')

    const primaryStr = refId(deal.primaryBuyerId)
    const wholesalerStr = refId(deal.wholesalerId)
    const titleRepStr = refId(deal.titleRepId)

    const isParty =
      role === UserRole.ADMIN ||
      (role === UserRole.TITLE_REP && titleRepStr === userId) ||
      primaryStr === userId ||
      wholesalerStr === userId

    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    return deal
  }

  // ── Get deals for a user ──────────────────────────────────────
  async findMyDeals(
    userId: string,
    role: string,
    listingId?: string,
  ): Promise<unknown[]> {
    let filter: Record<string, unknown> = { _id: null }

    if (role === UserRole.ADMIN) {
      filter = {}
    } else if (role === UserRole.BUYER) {
      filter = { primaryBuyerId: new Types.ObjectId(userId) }
    } else if (role === UserRole.REALTOR) {
      filter = {
        $or: [
          { primaryBuyerId: new Types.ObjectId(userId) },
          { wholesalerId: new Types.ObjectId(userId) },
        ],
      }
    } else if (role === UserRole.WHOLESALER) {
      filter = { wholesalerId: new Types.ObjectId(userId) }
    } else if (role === UserRole.TITLE_REP) {
      filter = { titleRepId: new Types.ObjectId(userId) }
    }

    if (listingId && Types.ObjectId.isValid(listingId)) {
      filter = {
        ...filter,
        listingId: new Types.ObjectId(listingId),
      }
    }

    return this.dealModel
      .find(filter)
      .populate('listingId', 'propertyAddress city stateCode')
      .populate('primaryBuyerId', 'fullName')
      .populate('titleRepId', 'fullName email')
      .sort({ createdAt: -1 })
      .lean()
      .exec()
  }

  // ── Advance pipeline step ─────────────────────────────────────
  async advanceStep(
    dealId: string,
    userId: string,
    role: string,
    dto: AdvanceStepDto,
  ): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    if (deal.disputeFrozen) {
      throw new ForbiddenException(
        'Deal is frozen due to an active dispute. Contact your title representative.',
      )
    }

    const currentIdx = STEP_ORDER.indexOf(deal.currentStep)
    const nextStep = STEP_ORDER[currentIdx + 1]

    if (!nextStep) {
      throw new BadRequestException('This deal has already reached the final step.')
    }

    if (dto.step !== nextStep) {
      throw new BadRequestException(`Next step must be "${nextStep}", not "${dto.step}".`)
    }

    if (TITLE_REP_STEPS.has(dto.step)) {
      if (role !== UserRole.TITLE_REP && role !== UserRole.ADMIN) {
        throw new ForbiddenException('Only the Title Representative can advance steps 4 through 8.')
      }
    } else {
      const isParty =
        deal.primaryBuyerId.toString() === userId ||
        deal.wholesalerId.toString() === userId ||
        role === UserRole.ADMIN

      if (!isParty) {
        throw new ForbiddenException('You are not a party to this deal.')
      }
    }

    deal.currentStep = dto.step
    const nowTs = new Date()
    switch (dto.step) {
      case DealStep.EMD_DEPOSITED:
        deal.emdDepositedAt = nowTs
        break
      case DealStep.INSPECTION_PERIOD:
        deal.inspectionCompletedAt = nowTs
        break
      case DealStep.APPRAISAL_ORDERED:
        deal.appraisalOrderedAt = nowTs
        break
      case DealStep.FINANCING_APPROVED:
        deal.financingApprovedAt = nowTs
        break
      case DealStep.TITLE_SEARCH_COMPLETE:
        deal.titleSearchCompleteAt = nowTs
        break
      case DealStep.CLEAR_TO_CLOSE:
        deal.clearToCloseAt = nowTs
        break
      case DealStep.FUNDED_CLOSED:
        deal.closedAt = nowTs
        break
      default:
        break
    }

    if (dto.step === DealStep.EMD_DEPOSITED) {
      deal.emdStatus = 'deposited'
    }

    if (dto.step === DealStep.FUNDED_CLOSED) {
      await this.listingModel
        .findByIdAndUpdate(deal.listingId, {
          status: ListingStatus.CLOSED,
        })
        .exec()
    }

    await deal.save()

    this.gateway.emitToDeal(dealId, SOCKET_EVENTS.DEAL_STEP_ADVANCED, {
      dealId,
      currentStep: deal.currentStep,
      updatedAt: new Date().toISOString(),
    })

    this.logger.log(`Deal ${dealId} advanced to ${dto.step} by ${userId}`)
    return deal
  }

  // ── Buyer failed to close ─────────────────────────────────────
  async buyerFailed(
    dealId: string,
    requesterId: string,
    role: string,
    dto: BuyerFailedDto,
  ): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    const isParty =
      deal.wholesalerId.toString() === requesterId ||
      deal.primaryBuyerId.toString() === requesterId ||
      role === UserRole.ADMIN

    if (!isParty) {
      throw new ForbiddenException('Not authorized.')
    }

    deal.buyerFailed = true
    deal.buyerFailedReason = dto.reason
    deal.buyerFailedAt = new Date()

    let backupPromoted = false

    const inspectionIdx = STEP_ORDER.indexOf(DealStep.INSPECTION_PERIOD)
    const currentIdx = STEP_ORDER.indexOf(deal.currentStep)

    if (currentIdx > inspectionIdx || dto.forfeitEmd) {
      deal.emdStatus = 'forfeited'
      deal.emdForfeited = true
      this.logger.warn(`EMD forfeited on deal ${dealId} — post-inspection withdrawal or explicit forfeit`)
    }

    if (deal.backup2BidId && deal.backup2BuyerId) {
      backupPromoted = true
      const promotedBidId = deal.backup2BidId
      const promotedBuyerId = deal.backup2BuyerId

      deal.primaryBidId = promotedBidId
      deal.primaryBuyerId = promotedBuyerId
      deal.backup2BidId = deal.backup3BidId
      deal.backup2BuyerId = deal.backup3BuyerId
      deal.backup3BidId = null
      deal.backup3BuyerId = null
      deal.backupActivationDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

      await this.bidModel
        .findByIdAndUpdate(promotedBidId, {
          status: BidStatus.PRIMARY,
        })
        .exec()

      this.logger.log(`Backup #2 promoted on deal ${dealId}. 24h activation window starts now.`)
    }

    await deal.save()

    if (backupPromoted) {
      this.gateway.emitToDeal(dealId, SOCKET_EVENTS.BACKUP_PROMOTED, {
        dealId,
        backup2BuyerId: deal.backup2BuyerId?.toString() ?? null,
      })
    }

    if (deal.backupActivationDeadline) {
      await this.jobsService.scheduleBackupActivation(deal._id.toString(), deal.backupActivationDeadline)
    }

    return deal
  }

  // ── Assign Title Company ──────────────────────────────────────
  async assignTitleCompany(dealId: string, buyerId: string, dto: TitleCompanyDto): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    if (deal.primaryBuyerId.toString() !== buyerId) {
      throw new ForbiddenException('Only the primary buyer can assign a title company.')
    }

    deal.titleCompanyName = dto.titleCompanyName
    deal.titleCompanyEmail = dto.titleCompanyEmail
    deal.emdWiringInstructions = dto.emdWiringInstructions ?? ''

    if (dto.titleRepId && Types.ObjectId.isValid(dto.titleRepId)) {
      deal.titleRepId = new Types.ObjectId(dto.titleRepId)
    }

    await deal.save()

    this.logger.log(`Title company assigned on deal ${dealId}: ${dto.titleCompanyName}`)
    return deal
  }

  async reassignTitleRep(dealId: string, titleRepId: string, role: string): Promise<DealDocument> {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can reassign title reps.')
    }
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }
    if (!Types.ObjectId.isValid(titleRepId)) {
      throw new BadRequestException('Invalid title rep ID.')
    }
    const deal = await this.dealModel.findByIdAndUpdate(
      dealId,
      { titleRepId: new Types.ObjectId(titleRepId) },
      { new: true },
    )
    if (!deal) {
      throw new NotFoundException('Deal not found.')
    }
    this.logger.log(`Title rep reassigned on deal ${dealId} → ${titleRepId}`)
    return deal
  }

  // ── Upload marketing proof ────────────────────────────────────
  async uploadMarketingProof(dealId: string, wholesalerId: string, proofUrl: string): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    if (deal.wholesalerId.toString() !== wholesalerId) {
      throw new ForbiddenException('Only the wholesaler can upload marketing proof.')
    }

    if (deal.marketingProofDeadline && new Date() > deal.marketingProofDeadline) {
      throw new BadRequestException('The 72-hour marketing proof deadline has passed.')
    }

    deal.marketingProofUploaded = true
    deal.marketingProofUrl = proofUrl

    await deal.save()

    await this.jobsService.cancel72hrCheck(deal._id.toString())

    this.logger.log(`Marketing proof uploaded for deal ${dealId}`)
    return deal
  }

  // ── Freeze deal (dispute) ───────────────────────────────────────
  async freezeDeal(dealId: string, adminId: string): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    deal.disputeFrozen = true
    deal.disputeInitiatedAt = new Date()

    await deal.save()

    this.gateway.emitToDeal(dealId, SOCKET_EVENTS.DEAL_FROZEN, {
      dealId,
      disputeFrozen: true,
    })

    this.logger.log(`Deal ${dealId} frozen by admin ${adminId}`)
    return deal
  }

  // ── Store backup buyer info (called after bid selection) ───────
  async setBackupBuyers(
    dealId: string,
    backup2BidId: string | null,
    backup2BuyerId: string | null,
    backup3BidId: string | null,
    backup3BuyerId: string | null,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(dealId)) return

    await this.dealModel
      .findByIdAndUpdate(dealId, {
        backup2BidId: backup2BidId ? new Types.ObjectId(backup2BidId) : null,
        backup2BuyerId: backup2BuyerId ? new Types.ObjectId(backup2BuyerId) : null,
        backup3BidId: backup3BidId ? new Types.ObjectId(backup3BidId) : null,
        backup3BuyerId: backup3BuyerId ? new Types.ObjectId(backup3BuyerId) : null,
      })
      .exec()
  }
}
