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
import { Model, Types } from 'mongoose'
import { Deal, DealDocument } from './schemas/deal.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import { Contract, ContractDocument } from '../contracts/schemas/contract.schema'
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
        'propertyAddress city stateCode zipCode dealType arv purchasePrice app1DealId',
      )
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
      .populate('listingId', 'propertyAddress city stateCode')
      .populate('primaryBuyerId', 'fullName')
      .populate('wholesalerId', 'fullName')
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

    if (BUYER_ADVANCE_STEPS.has(dto.step)) {
      if (role !== UserRole.ADMIN && deal.primaryBuyerId.toString() !== userId) {
        throw new ForbiddenException('Only the primary buyer can advance steps 4 through 8.')
      }
      // ponytail: title rep retired for MVP — buyer advances 4–8 with no titleRepId gate
    } else {
      if (role !== UserRole.ADMIN && deal.wholesalerId.toString() !== userId) {
        throw new ForbiddenException('Only the listing owner (wholesaler/realtor) can advance early steps.')
      }
    }

    // ponytail: PayPal platform fee gate deferred — advance after contract sign is unlocked

    const nowTs = new Date()
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
      { _id: dealId, currentStep: deal.currentStep, disputeFrozen: { $ne: true } },
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
