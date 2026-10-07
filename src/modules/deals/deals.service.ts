import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { ConfigService } from '@nestjs/config'
import { buyerResponse } from '../../common/utils/buyer-response'
import { buildTitlePackage, isPackageAssetUrl, assertPackageAssetUrl } from './title-package'
import { TitleHandlingDto } from './dto/title-handling.dto'
import { Model, Types } from 'mongoose'
import { Deal, DealDocument } from './schemas/deal.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Contract, ContractDocument } from '../contracts/schemas/contract.schema'
import { VaultDocument, VaultDocumentDocument } from '../vault/schemas/vault-document.schema'
import { CreateDealDto } from './dto/create-deal.dto'
import { AdvanceStepDto } from './dto/advance-step.dto'
import { BuyerFailedDto } from './dto/buyer-failed.dto'
import { TitleCompanyDto } from './dto/title-company.dto'
import { DealStep, STEP_ORDER, BUYER_ADVANCE_STEPS } from '../../common/enums/deal-step.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { KycStatus } from '../../common/enums/kyc-status.enum'
import { ContractStatus } from '../../common/enums/contract-status.enum'
import { JobsService } from '../jobs/jobs.service'
import { AppGateway } from '../gateway/app.gateway'
import { SOCKET_EVENTS } from '../gateway/socket-events.constants'
import { ResendService } from '../notifications/resend.service'
import { NotificationsService } from '../notifications/notifications.service'
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/schemas/notification.schema'
import { App1BidsService } from '../app1-bids/app1-bids.service'
import { CloudinaryService } from '../../common/services/cloudinary.service'
import { prepareUploadedContract } from '../contracts/uploaded-contract'
import { randomUUID } from 'crypto'
import axios from 'axios'

const DEAL_STEP_LABELS: Record<DealStep, string> = {
  [DealStep.CONTRACT_SIGNED]: 'Contract Signed',
  [DealStep.EMD_DEPOSITED]: 'EMD Deposited',
  [DealStep.INSPECTION_PERIOD]: 'Inspection',
  [DealStep.APPRAISAL_ORDERED]: 'Appraisal',
  [DealStep.FINANCING_APPROVED]: 'Financing',
  [DealStep.TITLE_SEARCH_COMPLETE]: 'Title Search',
  [DealStep.CLEAR_TO_CLOSE]: 'Clear to Close',
  [DealStep.FUNDED_CLOSED]: 'Funded & Closed',
}

function refId(ref: unknown): string | null {
  if (ref == null) return null
  if (typeof ref === 'object' && '_id' in (ref as object)) {
    return String((ref as { _id: Types.ObjectId })._id)
  }
  return String(ref)
}

/** Resend caps a whole message at 40 MB after base64, so leave headroom for the body. */
const MAX_EMAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
    @InjectModel(Contract.name)
    private readonly contractModel: Model<ContractDocument>,
    private readonly jobsService: JobsService,
    private readonly gateway: AppGateway,
    private readonly resendService: ResendService,
    private readonly notificationsService: NotificationsService,
    private readonly app1BidsService: App1BidsService,
    private readonly configService: ConfigService,
    private readonly cloudinaryService: CloudinaryService,
    @InjectModel(VaultDocument.name)
    private readonly vaultModel: Model<VaultDocumentDocument>,
  ) {}

  private async autoAssignTitleRep(): Promise<Types.ObjectId | null> {
    // ponytail: re-enable when AI title rep ships
    return null
    /* title-rep auto-assign disabled for MVP
    try {
      // Prefer KYC-approved reps; fall back to any non-banned title_rep (KYC may be auto/off).
      let titleReps = await this.userModel
        .find({
          role: UserRole.TITLE_REP,
          kycStatus: KycStatus.APPROVED,
          isBanned: { $ne: true },
        })
        .select('_id')
        .lean()
        .exec()

      if (!titleReps.length) {
        titleReps = await this.userModel
          .find({
            role: UserRole.TITLE_REP,
            isBanned: { $ne: true },
          })
          .select('_id')
          .lean()
          .exec()
      }

      if (!titleReps.length) {
        this.logger.warn('No title reps available for auto-assignment.')
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
    */
  }

  // ── Create deal only after DocuSeal both parties signed (App1 parity) ──
  async createDealFromContract(contractId: string): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(contractId)) {
      throw new NotFoundException('Contract not found.')
    }

    const contract = await this.contractModel.findById(contractId)
    if (!contract) {
      throw new NotFoundException('Contract not found.')
    }

    if (contract.status !== ContractStatus.SIGNED) {
      throw new BadRequestException('Contract must be fully signed before creating a deal.')
    }

    const byContract = await this.dealModel.findOne({ contractId: contract._id }).exec()
    if (byContract) {
      return byContract
    }

    const byListing = await this.dealModel
      .findOne({ listingId: contract.listingId })
      .exec()
    if (byListing) {
      if (!byListing.contractId) {
        byListing.contractId = contract._id as Types.ObjectId
        if (!byListing.contractSignedAt) {
          byListing.contractSignedAt = new Date()
        }
        // ponytail: no titleRepId until AI title rep ships
        await byListing.save()
      }
      return byListing
    }

    const bid = await this.bidModel.findById(contract.bidId).lean().exec()
    const listing = await this.listingModel.findById(contract.listingId).lean().exec()
    const now = new Date()
    const marketingFromApp1 =
      Boolean(listing?.marketingProofSatisfiedByListing) || Boolean(listing?.app1DealId)
    const deadline = marketingFromApp1 ? null : new Date(now.getTime() + 72 * 60 * 60 * 1000)
    // ponytail: titleRepId null until AI title rep ships
    const emdAmount =
      bid && typeof (bid as { emdAmount?: number }).emdAmount === 'number'
        ? (bid as { emdAmount: number }).emdAmount
        : 0

    let deal: DealDocument
    try {
      deal = await this.dealModel.create({
        listingId: contract.listingId,
        primaryBidId: contract.bidId,
        primaryBuyerId: contract.buyerId,
        wholesalerId: contract.wholesalerId,
        contractId: contract._id,
        titleRepId: null,
        currentStep: DealStep.CONTRACT_SIGNED,
        contractSignedAt: now,
        marketingProofDeadline: deadline,
        marketingProofUploaded: marketingFromApp1,
        marketingProofUrl: marketingFromApp1
          ? `app2-listing:${listing?.app1DealId ?? listing?._id ?? contract.listingId}`
          : null,
        emdAmount,
        emdStatus: 'pending',
      })
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: number }).code
          : undefined
      const msg = err instanceof Error ? err.message : String(err)
      if (code === 11000 || /E11000|duplicate key/i.test(msg)) {
        const existing = await this.dealModel
          .findOne({
            $or: [{ contractId: contract._id }, { listingId: contract.listingId }],
          })
          .exec()
        if (existing) return existing
        this.logger.error(`createDealFromContract duplicate key for contract ${contractId}: ${msg}`)
        throw new ConflictException(
          'Could not create deal due to a shared-database index conflict. Contact support if this persists.',
        )
      }
      throw err
    }

    contract.chatUnlocked = true
    await contract.save()

    // Capture the backup bids picked at 1-2-Delete selection so buyerFailed()
    // can promote them. Without this the deal is created with null backups and
    // the entire backup mechanism is inert.
    const backupBids = await this.bidModel
      .find({
        listingId: contract.listingId,
        status: { $in: [BidStatus.BACKUP_2, BidStatus.BACKUP_3] },
      })
      .sort({ backupPosition: 1 })
      .lean()
      .exec()
    const backup2 = backupBids.find((b) => b.status === BidStatus.BACKUP_2)
    const backup3 = backupBids.find((b) => b.status === BidStatus.BACKUP_3)
    if (backup2 || backup3) {
      await this.setBackupBuyers(
        deal._id.toString(),
        backup2 ? backup2._id.toString() : null,
        backup2 ? backup2.buyerId.toString() : null,
        backup3 ? backup3._id.toString() : null,
        backup3 ? backup3.buyerId.toString() : null,
      )
    }

    this.logger.log(
      `Deal ${deal._id} created from signed contract ${contractId} (listing ${contract.listingId})` +
        (backup2 || backup3
          ? ` with backups [${backup2 ? '#2' : ''}${backup3 ? ' #3' : ''} ]`
          : ''),
    )

    if (deal.marketingProofDeadline) {
      await this.jobsService.schedule72hrCheck(deal._id.toString(), deal.marketingProofDeadline)
    }

    if (marketingFromApp1 && listing?.app1DealId) {
      await this.app1BidsService.markMarketingComplete(
        String(listing.app1DealId),
        `app2-listing:${listing._id}`,
      )
    }

    await this.notificationsService.create({
      userId: contract.wholesalerId.toString(),
      channel: NotificationChannel.IN_APP,
      type: NotificationType.DEAL_ADVANCED,
      title: 'Deal is now active',
      body: 'Both parties signed. Open the deal tracker to advance to EMD deposit.',
      listingId: contract.listingId.toString(),
      dealId: deal._id.toString(),
    }).catch(() => null)

    await this.notificationsService.create({
      userId: contract.buyerId.toString(),
      channel: NotificationChannel.IN_APP,
      type: NotificationType.DEAL_ADVANCED,
      title: 'Deal is now active',
      body: 'Both parties signed. Open the deal tracker — the lister can advance to EMD deposit.',
      listingId: contract.listingId.toString(),
      dealId: deal._id.toString(),
    }).catch(() => null)

    // ponytail: PayPal platform fees deferred — skip ensurePlatformFeePayments for now

    return deal
  }

  /**
   * Public POST /deals — only recovers a deal when a signed contract already exists.
   * New deals are created by DocuSeal webhook via createDealFromContract.
   */
  async createDeal(
    dto: CreateDealDto,
    actorId: string,
    role: string,
  ): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dto.listingId)) {
      throw new BadRequestException('Invalid listingId.')
    }
    if (role !== UserRole.ADMIN && dto.wholesalerId !== actorId) {
      throw new ForbiddenException('wholesalerId must match the authenticated wholesaler.')
    }

    const existing = await this.dealModel
      .findOne({ listingId: new Types.ObjectId(dto.listingId) })
      .exec()
    if (existing) {
      return existing
    }

    const signed = await this.contractModel
      .findOne({
        listingId: new Types.ObjectId(dto.listingId),
        status: ContractStatus.SIGNED,
      })
      .exec()

    if (signed) {
      return this.createDealFromContract(signed._id.toString())
    }

    throw new BadRequestException(
      'Deal is not ready yet. Select a bid, open Create/Sign Contract, finish DocuSeal (lister then purchaser). The deal is created automatically after both signatures — do not call create-deal first.',
    )
  }

  /** Release primary bid + reopen listing when contract cancelled before a deal exists. */
  async demoteBidAndPromoteBackup(
    bidId: Types.ObjectId,
    listingId: Types.ObjectId,
  ): Promise<void> {
    const bid = await this.bidModel.findById(bidId)
    if (bid && bid.status === BidStatus.PRIMARY) {
      bid.status = BidStatus.REJECTED
      bid.backupPosition = null
      await bid.save()
    }

    const backup = await this.bidModel
      .findOne({
        listingId,
        status: { $in: [BidStatus.BACKUP_2, BidStatus.BACKUP_3] },
      })
      .sort({ backupPosition: 1 })
      .exec()

    if (backup) {
      backup.status = BidStatus.PRIMARY
      backup.backupPosition = null
      await backup.save()
      await this.listingModel
        .findByIdAndUpdate(listingId, {
          status: ListingStatus.UNDER_CONTRACT,
          feeLocked: true,
          bidsOpen: false,
        })
        .exec()
      return
    }

    await this.listingModel
      .findByIdAndUpdate(listingId, {
        status: ListingStatus.LIVE,
        feeLocked: false,
        bidsOpen: true,
      })
      .exec()
  }

  // ── Get single deal ───────────────────────────────────────────
  async findOne(dealId: string, userId: string, role: string): Promise<unknown> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel
      .findById(dealId)
      .populate(
        'listingId',
        'propertyAddress city stateCode zipCode dealType arv purchasePrice app1DealId photoUrls assignmentFeeLow assignmentFeeHigh rehabTotal estimatedHoldingCosts',
      )
      .populate('primaryBuyerId', 'fullName reliabilityScore avatarUrl')
      .populate('wholesalerId', 'fullName reliabilityScore avatarUrl')
      .populate('titleRepId', 'fullName email')
      .populate('contractId', 'status signedPdfUrl assignmentFeeFinal buyerSignedAt wholesalerSignedAt')
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
      // Realtor is seller/lister only in App2
      filter = { wholesalerId: new Types.ObjectId(userId) }
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
      .populate('listingId', 'propertyAddress city stateCode zipCode photoUrls purchasePrice assignmentFeeLow assignmentFeeHigh arv rehabTotal estimatedHoldingCosts')
      .populate('primaryBuyerId', 'fullName avatarUrl')
      .populate('wholesalerId', 'fullName avatarUrl')
      .populate('titleRepId', 'fullName email')
      .populate('contractId', 'status signedPdfUrl assignmentFeeFinal buyerSignedAt wholesalerSignedAt')
      .sort({ createdAt: -1 })
      .lean()
      .exec()
  }

  /**
   * Deals where the buyer picked TRACT/Admin as their title representative.
   * Only an admin can advance these past title search, so they need a queue
   * of their own rather than hunting through every deal.
   */
  async findTitleRepRequests(role: string): Promise<unknown[]> {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only an admin can review title representative requests.')
    }

    const deals = await this.dealModel
      .find({ titleHandling: 'tract' })
      .populate('listingId', 'propertyAddress city stateCode zipCode photoUrls purchasePrice assignmentFeeLow assignmentFeeHigh arv')
      .populate('primaryBuyerId', 'fullName email avatarUrl')
      .populate('wholesalerId', 'fullName email avatarUrl')
      .populate('titleRepId', 'fullName email')
      .populate('contractId', 'status signedPdfUrl assignmentFeeFinal buyerSignedAt wholesalerSignedAt')
      .sort({ updatedAt: -1 })
      .lean()
      .exec()

    const adminGateIdx = STEP_ORDER.indexOf(DealStep.TITLE_SEARCH_COMPLETE)
    return deals.map((deal) => {
      const currentIdx = STEP_ORDER.indexOf(deal.currentStep)
      const nextStep = STEP_ORDER[currentIdx + 1] ?? null
      return {
        ...deal,
        nextStep,
        // An open TRACT-handled deal with nobody assigned is waiting on an admin.
        needsAssignment: Boolean(nextStep) && !deal.buyerFailed && !deal.titleRepId,
        // Before title search the buyer still drives the pipeline; from title
        // search onward an admin or the assigned title rep advances it.
        awaitingAdmin: Boolean(
          nextStep && currentIdx >= adminGateIdx && !deal.disputeFrozen && !deal.buyerFailed,
        ),
      }
    })
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

    const tractHandlesTitle =
      deal.titleHandling === 'tract' && currentIdx >= STEP_ORDER.indexOf(DealStep.TITLE_SEARCH_COMPLETE)
    const isAssignedTitleRep =
      role === UserRole.TITLE_REP && Boolean(deal.titleRepId) && deal.titleRepId?.toString() === userId

    if (tractHandlesTitle) {
      if (role !== UserRole.ADMIN && !isAssignedTitleRep) {
        throw new ForbiddenException(
          'Only an admin or the assigned title representative can advance this deal while TRACT handles title.',
        )
      }
    } else if (BUYER_ADVANCE_STEPS.has(dto.step)) {
      if (role !== UserRole.ADMIN && deal.primaryBuyerId.toString() !== userId) {
        throw new ForbiddenException('Only the primary buyer can advance steps 4 through 8.')
      }
    } else {
      if (role !== UserRole.ADMIN && deal.wholesalerId.toString() !== userId) {
        throw new ForbiddenException('Only the listing owner (wholesaler/realtor) can advance early steps.')
      }
    }

    // ponytail: PayPal platform fee gate deferred — advance after contract sign is unlocked

    const nowTs = new Date()
    if (dto.step === DealStep.TITLE_SEARCH_COMPLETE && !deal.titleHandling) {
      throw new BadRequestException('Choose your own title representative or TRACT assistance before advancing to title search.')
    }
    const stepTimestampField: Partial<Record<DealStep, string>> = {
      [DealStep.EMD_DEPOSITED]: 'emdDepositedAt',
      [DealStep.INSPECTION_PERIOD]: 'inspectionCompletedAt',
      [DealStep.APPRAISAL_ORDERED]: 'appraisalOrderedAt',
      [DealStep.FINANCING_APPROVED]: 'financingApprovedAt',
      [DealStep.TITLE_SEARCH_COMPLETE]: 'titleSearchCompleteAt',
      [DealStep.CLEAR_TO_CLOSE]: 'clearToCloseAt',
      [DealStep.FUNDED_CLOSED]: 'closedAt',
    }
    const set: Record<string, unknown> = { currentStep: dto.step }
    const tsField = stepTimestampField[dto.step]
    if (tsField) set[tsField] = nowTs
    if (dto.step === DealStep.EMD_DEPOSITED) set.emdStatus = 'deposited'

    // Atomic compare-and-swap on currentStep. Concurrent requests for the same
    // next step all read `currentStep === expected`; only the one whose update
    // matches the still-unchanged value wins, so step side-effects (listing
    // close, App1 mark-closed, notifications) run exactly once.
    const claimed = await this.dealModel.findOneAndUpdate(
      { _id: dealId, currentStep: deal.currentStep, titleHandling: deal.titleHandling ?? null, disputeFrozen: { $ne: true } },
      { $set: set },
      { new: true },
    )
    if (!claimed) {
      throw new ConflictException(
        'This deal step was just advanced. Refresh to see the current state.',
      )
    }
    deal.currentStep = claimed.currentStep

    if (dto.step === DealStep.FUNDED_CLOSED) {
      await this.listingModel
        .findByIdAndUpdate(deal.listingId, {
          status: ListingStatus.CLOSED,
        })
        .exec()

      const listing = await this.listingModel
        .findById(deal.listingId)
        .select('app1DealId')
        .lean()
        .exec()
      await this.app1BidsService.markDealClosed(listing?.app1DealId)
    }

    this.gateway.emitToDeal(dealId, SOCKET_EVENTS.DEAL_STEP_ADVANCED, {
      dealId,
      currentStep: claimed.currentStep,
      updatedAt: new Date().toISOString(),
    })

    if (STEP_ORDER.indexOf(dto.step) >= STEP_ORDER.indexOf(DealStep.TITLE_SEARCH_COMPLETE)) {
      await this.notifyAdminsOfTitleProgress(claimed).catch((error: unknown) => {
        this.logger.error('Unable to notify admins of title progress', error)
      })
    }

    const stepLabel = DEAL_STEP_LABELS[dto.step] ?? dto.step
    const recipientIds = new Set<string>()
    const buyerId = deal.primaryBuyerId.toString()
    const wholesalerId = deal.wholesalerId.toString()

    if (buyerId !== userId) recipientIds.add(buyerId)
    if (wholesalerId !== userId) recipientIds.add(wholesalerId)

    for (const recipientId of recipientIds) {
      await this.notificationsService.create({
        userId: recipientId,
        channel: NotificationChannel.IN_APP,
        type: NotificationType.DEAL_ADVANCED,
        title: 'Deal advanced',
        body: `Deal advanced to ${stepLabel}.`,
        dealId,
        listingId: deal.listingId.toString(),
      })
    }

    this.logger.log(`Deal ${dealId} advanced to ${dto.step} by ${userId}`)
    return claimed
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
      const failedBidId = deal.primaryBidId
      const promotedBidId = deal.backup2BidId
      const promotedBuyerId = deal.backup2BuyerId

      deal.primaryBidId = promotedBidId
      deal.primaryBuyerId = promotedBuyerId
      deal.backup2BidId = deal.backup3BidId
      deal.backup2BuyerId = deal.backup3BuyerId
      deal.backup3BidId = null
      deal.backup3BuyerId = null
      deal.backupActivationDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000)

      await Promise.all([
        // Failed buyer's bid is out of the running.
        this.bidModel
          .findByIdAndUpdate(failedBidId, { status: BidStatus.REJECTED })
          .exec(),
        this.bidModel
          .findByIdAndUpdate(promotedBidId, { status: BidStatus.PRIMARY })
          .exec(),
      ])

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

  async chooseTitleHandling(dealId: string, userId: string, role: string, dto: TitleHandlingDto) {
    await this.findOne(dealId, userId, role)
    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')
    if (role !== UserRole.ADMIN && deal.primaryBuyerId.toString() !== userId) {
      throw new ForbiddenException('Only the primary buyer can choose title handling.')
    }
    if (deal.disputeFrozen || deal.currentStep === DealStep.FUNDED_CLOSED) {
      throw new BadRequestException('Title handling cannot be changed on a frozen or closed deal.')
    }
    if (role !== UserRole.ADMIN && STEP_ORDER.indexOf(deal.currentStep) >= STEP_ORDER.indexOf(DealStep.TITLE_SEARCH_COMPLETE)) {
      throw new ForbiddenException('Title handling can only be changed by an admin after title search begins.')
    }
    const updated = await this.dealModel.findOneAndUpdate(
      { _id: dealId, currentStep: deal.currentStep, disputeFrozen: { $ne: true } },
      {
        $set: {
          titleHandling: dto.titleHandling,
          // A TRACT title rep only belongs on TRACT-handled deals.
          ...(dto.titleHandling === 'own_rep' ? { titleRepId: null, titleRepAssignedAt: null } : {}),
        },
      },
      { new: true },
    )
    if (!updated) throw new ConflictException('This deal changed. Refresh before choosing title handling.')
    this.gateway.emitToDeal(dealId, SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId, currentStep: updated.currentStep })
    if (dto.titleHandling === 'tract') {
      await this.notifyAdminsOfTitleRepRequest(updated)
    }
    return updated
  }

  /**
   * The buyer just named TRACT as their title representative. Admins own every
   * step from title search on, so put the request in front of them right away.
   */
  private async notifyAdminsOfTitleRepRequest(deal: DealDocument): Promise<void> {
    const [admins, listing] = await Promise.all([
      this.userModel.find({ role: UserRole.ADMIN, isBanned: { $ne: true } }).select('_id').lean().exec(),
      this.listingModel.findById(deal.listingId).select('propertyAddress city stateCode').lean().exec(),
    ])
    const address = [listing?.propertyAddress, listing?.city, listing?.stateCode].filter(Boolean).join(', ')
    const dealId = deal._id.toString()
    await Promise.all(admins.map(async (admin) => {
      this.gateway.emitToUser(admin._id.toString(), SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId, currentStep: deal.currentStep })
      await this.notificationsService.create({
        userId: admin._id.toString(),
        channel: NotificationChannel.IN_APP,
        type: NotificationType.DEAL_ADVANCED,
        title: 'Title representative request',
        body: `The buyer selected TRACT as their title representative for ${address || 'a deal'}. Assign a title representative under Title Requests.`,
        dealId,
        listingId: deal.listingId.toString(),
      })
    }))
  }

  private async notifyAdminsOfTitleProgress(deal: DealDocument): Promise<void> {
    const admins = await this.userModel.find({ role: UserRole.ADMIN, isBanned: { $ne: true } }).select('_id').lean().exec()
    const dealId = deal._id.toString()
    const body = deal.titleHandling === 'tract'
      ? 'The buyer selected Admin to handle title. Only an admin can advance the remaining steps. Open the deal for property details, prices, pictures and the signed contract package.'
      : 'The buyer selected their own title representative. Open the deal for property details, prices, pictures and the signed contract package.'
    await Promise.all(admins.map(async (admin) => {
      this.gateway.emitToUser(admin._id.toString(), SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId, currentStep: deal.currentStep })
      if (deal.currentStep === DealStep.TITLE_SEARCH_COMPLETE) {
        await this.notificationsService.create({
          userId: admin._id.toString(), channel: NotificationChannel.IN_APP,
          type: NotificationType.DEAL_ADVANCED, title: 'Deal entered title search', body,
          dealId, listingId: deal.listingId.toString(),
        })
      }
    }))
  }

  async downloadTitlePackage(dealId: string, userId: string, role: string): Promise<Buffer> {
    await this.findOne(dealId, userId, role)
    const deal = await this.dealModel.findById(dealId)
    if (!deal?.titleHandling) throw new BadRequestException('Choose title handling before downloading the package.')
    const isBuyer = role !== UserRole.ADMIN && deal.primaryBuyerId.toString() === userId && deal.wholesalerId.toString() !== userId
    return this.buildDealTitlePackage(deal, isBuyer)
  }

  /** Zip of the signed buyer/lister contract, property photos and a property summary PDF. */
  private async buildDealTitlePackage(deal: DealDocument, redactForBuyer: boolean): Promise<Buffer> {
    const dealId = deal._id.toString()
    const [listing, contract] = await Promise.all([
      this.listingModel.findById(deal.listingId),
      this.contractModel.findById(deal.contractId),
    ])
    if (!listing) throw new NotFoundException('The property for this deal is missing.')
    if (!contract || contract.status !== ContractStatus.SIGNED) {
      throw new BadRequestException('The fully signed buyer/lister contract is not available yet. Try again after both signatures have been processed.')
    }

    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? ''
    let signedPdfUrl = contract.signedPdfUrl
    if (!signedPdfUrl) {
      throw new BadRequestException('The fully signed buyer/lister contract is not available yet. Try again after both signatures have been processed.')
    }
    if (!isPackageAssetUrl(signedPdfUrl, cloudName)) {
      signedPdfUrl = await this.rehostSignedPdfToCloudinary(contract._id.toString(), listing._id.toString(), signedPdfUrl)
    }

    const photoAssets = (listing.photoUrls ?? [])
      .filter((url) => typeof url === 'string' && isPackageAssetUrl(url, cloudName))
      .slice(0, 30)
      .map((url, index) => ({
        name: `property-pictures/photo-${index + 1}.${/\.(png|webp|gif|jpeg|jpg)(?:\?|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'jpg'}`,
        url,
      }))

    const details = {
      dealId, titleHandling: deal.titleHandling,
      dealType: listing.dealType, marketStatus: listing.marketStatus,
      address: [listing.propertyAddress, listing.city, listing.stateCode, listing.zipCode].filter(Boolean).join(', '),
      prices: { purchasePrice: listing.purchasePrice, askingAssignmentPrice: listing.assignmentFeeHigh,
        agreedAssignmentPrice: contract.assignmentFeeFinal, arv: listing.arv, emdAmount: deal.emdAmount },
    }
    return buildTitlePackage(redactForBuyer ? buyerResponse(details) : details, [
      { name: 'signed-buyer-lister-contract.pdf', url: signedPdfUrl },
      ...photoAssets,
    ], cloudName)
  }

  /** Re-host a signed PDF that landed outside Cloudinary (e.g. transient DocuSeal URL). */
  private async rehostSignedPdfToCloudinary(
    contractId: string,
    listingId: string,
    sourceUrl: string,
  ): Promise<string> {
    let host: string
    try {
      host = new URL(sourceUrl).hostname.toLowerCase()
    } catch {
      throw new BadRequestException('The signed contract URL is invalid. Contact support to re-process the agreement.')
    }
    const allowed =
      host === 'res.cloudinary.com' ||
      host.endsWith('.docuseal.com') ||
      host.endsWith('.docuseal.eu') ||
      host === 'docuseal.com' ||
      host === 'docuseal.eu'
    if (!allowed) {
      throw new BadRequestException(
        'The signed contract is not in approved storage. Contact support to re-process the agreement PDF.',
      )
    }

    try {
      const response = await axios.get<ArrayBuffer>(sourceUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 3,
        timeout: 20_000,
        maxContentLength: 15 * 1024 * 1024,
        maxBodyLength: 15 * 1024 * 1024,
      })
      const uploaded = await this.cloudinaryService.uploadFile(
        Buffer.from(response.data),
        `contracts/${listingId}`,
        `signed_contract_${contractId}.pdf`,
        'application/pdf',
      )
      await this.contractModel.findByIdAndUpdate(contractId, { signedPdfUrl: uploaded.secure_url }).exec()
      assertPackageAssetUrl(uploaded.secure_url, this.configService.get<string>('CLOUDINARY_CLOUD_NAME') ?? '')
      return uploaded.secure_url
    } catch (error) {
      if (error instanceof BadRequestException) throw error
      this.logger.warn(
        `Failed to re-host signed PDF for contract ${contractId}: ${error instanceof Error ? error.message : String(error)}`,
      )
      throw new BadRequestException(
        'Could not prepare the signed contract for download. Try again in a moment, or contact support.',
      )
    }
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

  async notifyTitleCompany(
    dealId: string,
    userId: string,
    role: string,
  ): Promise<{ sent: boolean; to: string }> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }

    const deal = await this.dealModel
      .findById(dealId)
      .populate('listingId', 'propertyAddress city stateCode zipCode')
      .populate('primaryBuyerId', 'fullName email')
      .populate('wholesalerId', 'fullName email')
      .exec()

    if (!deal) throw new NotFoundException('Deal not found.')

    const isParty =
      deal.primaryBuyerId &&
      (refId(deal.primaryBuyerId) === userId ||
        refId(deal.wholesalerId) === userId ||
        role === UserRole.ADMIN)

    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    const to = (deal.titleCompanyEmail ?? '').trim()
    if (!to) {
      throw new BadRequestException('No title company email on this deal. Assign a title company first.')
    }

    const listing = deal.listingId as unknown as {
      propertyAddress?: string
      city?: string
      stateCode?: string
      zipCode?: string
    } | null
    const buyer = deal.primaryBuyerId as unknown as { fullName?: string } | null
    const wholesaler = deal.wholesalerId as unknown as { fullName?: string } | null

    const addressParts = [
      listing?.propertyAddress,
      listing?.city,
      listing?.stateCode,
      listing?.zipCode,
    ].filter(Boolean)
    const address = addressParts.join(', ') || 'Address on file'
    const buyerName = buyer?.fullName?.trim() || 'Buyer'
    const wholesalerName = wholesaler?.fullName?.trim() || 'Wholesaler'
    const dealRef = `Deal #D-${dealId.slice(-8).toUpperCase()}`
    const companyName = deal.titleCompanyName?.trim() || 'Title Company'

    const subject = `TRACT — Wire intent notice for ${address}`
    const text =
      `Hello ${companyName},\n\n` +
      `The buyer on TRACT has indicated they are preparing to wire the earnest money deposit.\n\n` +
      `Deal: ${dealRef}\n` +
      `Property: ${address}\n` +
      `Buyer: ${buyerName}\n` +
      `Wholesaler / Lister: ${wholesalerName}\n` +
      `EMD amount on file: $${Number(deal.emdAmount ?? 0).toLocaleString()}\n\n` +
      `Please watch for incoming funds referencing this deal.\n\n` +
      `— TRACT Marketplace`

    const html = `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5">
  <p>Hello ${escapeHtml(companyName)},</p>
  <p>The buyer on TRACT has indicated they are preparing to wire the earnest money deposit.</p>
  <ul>
    <li><strong>Deal:</strong> ${escapeHtml(dealRef)}</li>
    <li><strong>Property:</strong> ${escapeHtml(address)}</li>
    <li><strong>Buyer:</strong> ${escapeHtml(buyerName)}</li>
    <li><strong>Wholesaler / Lister:</strong> ${escapeHtml(wholesalerName)}</li>
    <li><strong>EMD amount on file:</strong> $${Number(deal.emdAmount ?? 0).toLocaleString()}</li>
  </ul>
  <p>Please watch for incoming funds referencing this deal.</p>
  <p>— TRACT Marketplace</p>
</body></html>`

    const sent = await this.resendService.sendMail(to, subject, html, text)
    if (!sent) {
      throw new InternalServerErrorException('Failed to send email to the title company.')
    }

    this.logger.log(`Title company notified for deal ${dealId} → ${to}`)
    return { sent: true, to }
  }

  // ── Assign TRACT title rep (admin only) ───────────────────────
  async assignTitleRep(dealId: string, titleRepId: string): Promise<DealDocument> {
    if (!Types.ObjectId.isValid(dealId)) {
      throw new NotFoundException('Deal not found.')
    }
    if (!Types.ObjectId.isValid(titleRepId)) {
      throw new BadRequestException('Select a valid title representative.')
    }

    const [deal, rep] = await Promise.all([
      this.dealModel.findById(dealId),
      this.userModel
        .findOne({ _id: new Types.ObjectId(titleRepId), role: UserRole.TITLE_REP })
        .select('fullName email isBanned')
        .lean()
        .exec(),
    ])
    if (!deal) throw new NotFoundException('Deal not found.')
    if (!rep) throw new BadRequestException('That user is not a title representative.')
    if (rep.isBanned) throw new BadRequestException('That title representative is suspended.')
    if (deal.titleHandling !== 'tract') {
      throw new BadRequestException(
        'A title representative can only be assigned after the buyer selects TRACT/Admin to handle title.',
      )
    }
    if (deal.currentStep === DealStep.FUNDED_CLOSED) {
      throw new BadRequestException('This deal is already closed.')
    }
    if (deal.titleRepId?.toString() === titleRepId) {
      throw new BadRequestException(`${rep.fullName} is already assigned to this deal.`)
    }

    const previousRepId = deal.titleRepId?.toString() ?? null
    const updated = await this.dealModel.findOneAndUpdate(
      { _id: deal._id, titleHandling: 'tract', titleRepId: deal.titleRepId ?? null },
      { $set: { titleRepId: new Types.ObjectId(titleRepId), titleRepAssignedAt: new Date() } },
      { new: true },
    )
    if (!updated) {
      throw new ConflictException('This deal changed. Refresh and try again.')
    }

    this.logger.log(
      `Title rep ${titleRepId} assigned to deal ${dealId}${previousRepId ? ` (was ${previousRepId})` : ''}`,
    )

    // Delivery problems must not undo the assignment — the rep still sees the
    // deal on their dashboard.
    try {
      await this.notifyTitleRepAssignment(
        updated,
        { id: titleRepId, fullName: rep.fullName, email: rep.email },
        previousRepId,
      )
    } catch (err) {
      this.logger.error(`Title rep assignment notifications failed for deal ${dealId}:`, err)
    }

    return updated
  }

  /** In-app notices to the new rep, the buyer and any previous rep; the full dossier email follows in the background. */
  private async notifyTitleRepAssignment(
    deal: DealDocument,
    rep: { id: string; fullName: string; email: string },
    previousRepId: string | null,
  ): Promise<void> {
    const dealId = deal._id.toString()
    const listing = await this.listingModel
      .findById(deal.listingId)
      .select('propertyAddress city stateCode zipCode')
      .lean()
      .exec()
    const address =
      [listing?.propertyAddress, listing?.city, listing?.stateCode, listing?.zipCode].filter(Boolean).join(', ') ||
      'Address on file'

    const listingId = deal.listingId.toString()
    const notices: { userId: string; title: string; body: string }[] = [
      {
        userId: rep.id,
        title: 'New deal assigned to you',
        body: `You are the title representative for ${address}. The full deal details have been emailed to you.`,
      },
      {
        userId: deal.primaryBuyerId.toString(),
        title: 'Title representative assigned',
        body: `${rep.fullName} from TRACT is now handling title for ${address}.`,
      },
    ]
    if (previousRepId) {
      notices.push({
        userId: previousRepId,
        title: 'Deal reassigned',
        body: `${address} was reassigned to another title representative.`,
      })
    }
    await Promise.all(
      notices.map((n) =>
        this.notificationsService.create({
          userId: n.userId,
          channel: NotificationChannel.IN_APP,
          type: NotificationType.DEAL_ADVANCED,
          title: n.title,
          body: n.body,
          dealId,
          listingId,
        }),
      ),
    )

    this.gateway.emitToUser(rep.id, SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId, currentStep: deal.currentStep })
    this.gateway.emitToDeal(dealId, SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId, currentStep: deal.currentStep })

    // Building the title package can take ~30s, longer than the admin's request
    // should wait, so the dossier email is sent in the background.
    void this.emailTitleRepDossier(deal, rep).catch((err) =>
      this.logger.error(`Title rep dossier email failed for deal ${dealId}:`, err),
    )
  }

  /**
   * Everything TRACT holds about the deal: property, prices, rehab, contract,
   * winning bid, every party (incl. backups), pipeline dates, EMD, marketing
   * proof, links to all photos and shared vault documents — plus the title
   * package zip attached when the signed contract is available.
   */
  private async emailTitleRepDossier(
    deal: DealDocument,
    rep: { id: string; fullName: string; email: string },
  ): Promise<boolean> {
    const dealId = deal._id.toString()
    const userFields = 'fullName email phone stateCode role'
    const findUser = (id: Types.ObjectId | null | undefined) =>
      id ? this.userModel.findById(id).select(userFields).lean().exec() : Promise.resolve(null)

    const [listing, contract, bid, buyer, wholesaler, backup2, backup3, docs] = await Promise.all([
      this.listingModel.findById(deal.listingId).select('+assignmentFeeLow').lean().exec(),
      deal.contractId ? this.contractModel.findById(deal.contractId).lean().exec() : Promise.resolve(null),
      deal.primaryBidId ? this.bidModel.findById(deal.primaryBidId).lean().exec() : Promise.resolve(null),
      findUser(deal.primaryBuyerId),
      findUser(deal.wholesalerId),
      findUser(deal.backup2BuyerId),
      findUser(deal.backup3BuyerId),
      this.vaultModel
        .find({ dealId: deal._id, isDeleted: { $ne: true }, visibleTo: { $in: ['all', UserRole.TITLE_REP] } })
        .select('fileName fileUrl fileType createdAt')
        .sort({ createdAt: 1 })
        .lean()
        .exec(),
    ])

    type Value = string | { label: string; href: string }
    type Section = { title: string; rows: [string, Value][] }

    const money = (n?: number | null) =>
      typeof n === 'number' && Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
    const humanize = (v?: string | null) =>
      v ? v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—'
    const date = (d?: Date | string | null) => {
      if (!d) return '—'
      const parsed = new Date(d)
      return Number.isNaN(parsed.getTime())
        ? '—'
        : `${parsed.toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET`
    }
    const yesNo = (b?: boolean | null) => (b ? 'Yes' : 'No')
    const link = (href?: string | null, label = 'Open'): Value => (href ? { label, href } : '—')
    const person = (title: string, u: { fullName?: string; email?: string; phone?: string; stateCode?: string; role?: string } | null): Section => ({
      title,
      rows: [
        ['Name', u?.fullName || '—'],
        ['Email', u?.email || '—'],
        ['Phone', u?.phone || '—'],
        ['Role', humanize(u?.role)],
        ['State', u?.stateCode || '—'],
      ],
    })

    const address =
      [listing?.propertyAddress, listing?.city, listing?.stateCode, listing?.zipCode].filter(Boolean).join(', ') ||
      'Address on file'
    const dealRef = `Deal #D-${dealId.slice(-8).toUpperCase()}`
    const dealUrl = `${this.configService.get<string>('frontendUrl') ?? ''}/deals/${dealId}`

    const rehabRows: [string, Value][] = Object.entries(listing?.rehabBreakdown ?? {}).map(([item, cost]) => [
      humanize(item),
      money(cost),
    ])

    const sections: Section[] = [
      {
        title: 'Deal',
        rows: [
          ['Reference', dealRef],
          ['Deal ID', dealId],
          ['Open in TRACT', link(dealUrl, dealUrl)],
          ['Current step', humanize(deal.currentStep)],
          ['Title handling', deal.titleHandling === 'tract' ? 'TRACT / Admin title representative' : humanize(deal.titleHandling)],
          ['Assigned to you', date(deal.titleRepAssignedAt)],
          ['Dispute frozen', deal.disputeFrozen ? `Yes (since ${date(deal.disputeInitiatedAt)})` : 'No'],
          [
            'Buyer failed',
            deal.buyerFailed ? `Yes — ${humanize(deal.buyerFailedReason)} (${date(deal.buyerFailedAt)})` : 'No',
          ],
        ],
      },
      {
        title: 'Property',
        rows: [
          ['Address', address],
          ['Deal type', humanize(listing?.dealType)],
          ['Market status', humanize(listing?.marketStatus)],
          ['Listing status', humanize(listing?.status)],
          ['Published', date(listing?.publishedAt)],
          ['Bids received', String(listing?.bidCount ?? 0)],
          ['Video', link(listing?.videoUrl, 'Watch video')],
          ['App 1 (seller tract) deal', listing?.app1DealId || '—'],
        ],
      },
      {
        title: 'Prices',
        rows: [
          ['Seller purchase price', money(listing?.purchasePrice)],
          ['Agreed assignment price (contract)', money(contract?.assignmentFeeFinal)],
          ['Winning bid', money(bid?.assignmentPrice)],
          ['Asking / market price', money(listing?.assignmentFeeHigh)],
          ['Minimum sale price', money(listing?.assignmentFeeLow)],
          ['ARV', money(listing?.arv)],
          ['Rehab total', money(listing?.rehabTotal)],
          ['Estimated holding costs', money(listing?.estimatedHoldingCosts)],
          ['Projected buyer profit', money(listing?.projectedBuyerProfit)],
        ],
      },
      ...(rehabRows.length ? [{ title: 'Rehab breakdown', rows: rehabRows }] : []),
      {
        title: 'Earnest money (EMD)',
        rows: [
          ['EMD amount', money(deal.emdAmount)],
          ['EMD status', humanize(deal.emdStatus)],
          ['Deposited', date(deal.emdDepositedAt)],
          ['Forfeited', yesNo(deal.emdForfeited)],
          ['Wiring instructions', deal.emdWiringInstructions?.trim() || '—'],
        ],
      },
      {
        title: 'Buyer / lister contract',
        rows: [
          ['Status', humanize(contract?.status ?? 'not on file')],
          ['Signing method', humanize(contract?.signingMethod)],
          ['Lister signed', date(contract?.wholesalerSignedAt)],
          ['Buyer signed', date(contract?.buyerSignedAt)],
          ['Signed contract PDF', link(contract?.signedPdfUrl, 'Download signed contract')],
          ['Signature audit log', link(contract?.auditLogUrl, 'Download audit log')],
        ],
      },
      {
        title: 'Winning bid terms',
        rows: [
          ['Offer', money(bid?.assignmentPrice)],
          ['EMD offered', money(bid?.emdAmount)],
          ['Proposed closing date', date(bid?.proposedClosingDate)],
          ['Inspection period', bid?.inspectionDays ? `${bid.inspectionDays} days` : '—'],
          ['Special terms', bid?.specialTerms?.trim() || '—'],
          ['Buyer agent commission', bid?.commissionPct != null ? `${bid.commissionPct}%` : '—'],
          ['Agency role', humanize(bid?.agencyRole)],
          ['Fee paid by', humanize(bid?.feePaidBy)],
          ['Submitted', date(bid?.submittedAt)],
        ],
      },
      person('Buyer', buyer),
      person('Wholesaler / Lister', wholesaler),
      ...(backup2 ? [person('Backup buyer #2', backup2)] : []),
      ...(backup3 ? [person('Backup buyer #3', backup3)] : []),
      ...(backup2 || backup3
        ? [{ title: 'Backups', rows: [['Backup activation deadline', date(deal.backupActivationDeadline)]] as [string, Value][] }]
        : []),
      {
        title: 'Pipeline',
        rows: [
          ['1. Contract signed', date(deal.contractSignedAt)],
          ['2. EMD deposited', date(deal.emdDepositedAt)],
          ['3. Inspection complete', date(deal.inspectionCompletedAt)],
          ['4. Appraisal ordered', date(deal.appraisalOrderedAt)],
          ['5. Financing approved', date(deal.financingApprovedAt)],
          ['6. Title search', date(deal.titleSearchCompleteAt)],
          ['7. Clear to close', date(deal.clearToCloseAt)],
          ['8. Funded & closed', date(deal.closedAt)],
        ],
      },
      {
        title: 'Marketing proof',
        rows: [
          ['Deadline', date(deal.marketingProofDeadline)],
          ['Uploaded', yesNo(deal.marketingProofUploaded)],
          ['Proof document', link(deal.marketingProofUrl, 'Open marketing proof')],
        ],
      },
      {
        title: `Property photos (${listing?.photoUrls?.length ?? 0})`,
        rows: (listing?.photoUrls ?? []).map((url, i): [string, Value] => [`Photo ${i + 1}`, link(url, 'View photo')]),
      },
      {
        title: `Deal documents (${docs.length})`,
        rows: docs.map((d): [string, Value] => [
          `${d.fileName} (${humanize(d.fileType)})`,
          link(d.fileUrl, 'Download'),
        ]),
      },
    ]

    // Attach the title package when it can be built; the rep can always download it from the deal page.
    let attachments: { filename: string; content: Buffer }[] | undefined
    let packageNote: string
    try {
      const zip = await this.buildDealTitlePackage(deal, false)
      if (zip.length <= MAX_EMAIL_ATTACHMENT_BYTES) {
        attachments = [{ filename: `title-package-${dealId}.zip`, content: zip }]
        packageNote = 'The title package (signed contract, property photos and property summary PDF) is attached.'
      } else {
        packageNote = 'The title package is too large to email — download it from the deal page.'
      }
    } catch (err) {
      const reason = err instanceof BadRequestException || err instanceof NotFoundException ? err.message : 'it could not be built right now.'
      packageNote = `The title package is not attached: ${reason} You can download it from the deal page once available.`
    }

    const renderText = (v: Value) => (typeof v === 'string' ? v : `${v.label}: ${v.href}`)
    const renderHtml = (v: Value) =>
      typeof v === 'string' ? escapeHtml(v) : `<a href="${escapeHtml(v.href)}">${escapeHtml(v.label)}</a>`

    const subject = `TRACT — New title assignment: ${address}`
    const text =
      `Hello ${rep.fullName},\n\n` +
      `A TRACT admin has assigned you as title representative on ${dealRef} (${address}). ` +
      `Below is everything TRACT holds about this deal.\n\n${packageNote}\n\n` +
      sections
        .map((s) => `== ${s.title} ==\n` + (s.rows.length ? s.rows.map(([k, v]) => `${k}: ${renderText(v)}`).join('\n') : 'None'))
        .join('\n\n') +
      `\n\nOpen the deal: ${dealUrl}\n\n— TRACT Marketplace`
    const html = `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:720px">
  <p>Hello ${escapeHtml(rep.fullName)},</p>
  <p>A TRACT admin has assigned you as title representative on <strong>${escapeHtml(dealRef)}</strong> — ${escapeHtml(address)}. Below is everything TRACT holds about this deal.</p>
  <p style="background:#f5f5f1;border-radius:8px;padding:12px">${escapeHtml(packageNote)}</p>
  <p><a href="${escapeHtml(dealUrl)}" style="background:#174d34;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Open deal in TRACT</a></p>
  ${sections
    .map(
      (s) => `
  <h3 style="margin:28px 0 8px;color:#174d34;font-size:16px">${escapeHtml(s.title)}</h3>
  ${
    s.rows.length
      ? `<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:14px;width:100%">${s.rows
          .map(
            ([k, v]) =>
              `<tr><td style="color:#6B7280;border-bottom:1px solid #eee;width:40%;vertical-align:top"><strong>${escapeHtml(k)}</strong></td><td style="border-bottom:1px solid #eee;white-space:pre-wrap">${renderHtml(v)}</td></tr>`,
          )
          .join('')}</table>`
      : '<p style="color:#6B7280;font-size:14px">None</p>'
  }`,
    )
    .join('')}
  <p style="margin-top:28px">— TRACT Marketplace</p>
</body></html>`

    const sent = await this.resendService.sendMail(rep.email, subject, html, text, attachments)
    if (!sent) this.logger.warn(`Title assignment email to ${rep.email} failed for deal ${dealId}`)
    return sent
  }

  // ── Upload marketing proof ────────────────────────────────────
  async uploadMarketingProof(
    dealId: string,
    wholesalerId: string,
    file?: { buffer: Buffer; mimetype: string; originalname: string },
  ): Promise<DealDocument> {
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

    const prepared = await prepareUploadedContract(file)
    const uploaded = await this.cloudinaryService.uploadFile(
      prepared.buffer,
      `marketing-proof/${dealId}`,
      `marketing_proof_${dealId}_${randomUUID()}.pdf`,
      'application/pdf',
    )

    deal.marketingProofUploaded = true
    deal.marketingProofUrl = uploaded.secure_url

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
