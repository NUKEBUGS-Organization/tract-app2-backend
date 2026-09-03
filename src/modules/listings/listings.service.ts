import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  OnModuleInit,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Listing, ListingDocument } from './schemas/listing.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { CreateListingDto } from './dto/create-listing.dto'
import { UpdateListingDto } from './dto/update-listing.dto'
import { QueryListingsDto } from './dto/query-listings.dto'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { App1BidsService } from '../app1-bids/app1-bids.service'
import { CloudinaryService } from '../../common/services/cloudinary.service'
import { isMongoDuplicateKeyError } from '../../common/utils/mongo-errors'
import { ConflictException } from '@nestjs/common'

const LISTING_PHOTO_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function listingOwnerId(wholesalerRef: unknown): string | null {
  if (wholesalerRef == null) return null
  if (typeof wholesalerRef === 'object' && '_id' in (wholesalerRef as object)) {
    return String((wholesalerRef as { _id: Types.ObjectId })._id)
  }
  return String(wholesalerRef)
}
const MAX_LISTING_PHOTO_BYTES = 8 * 1024 * 1024

export type App1DealListingStatusDto =
  | { status: 'marketing_pending' }
  | { status: 'listed'; listingId: string; listingStatus: string }
  | {
      status: 'under_contract'
      listingId: string
      dealId: string
      currentStep: string
      titleRepAssigned: boolean
    }
  | { status: 'sold'; listingId: string; dealId: string; closedAt: string | null }
  | { status: 'cancelled'; listingId: string }
  | { status: 'source_deal_fell_through'; listingId: string }

@Injectable()
export class ListingsService implements OnModuleInit {
  private readonly logger = new Logger(ListingsService.name)

  constructor(
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,

    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,

    private readonly app1BidsService: App1BidsService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  /**
   * Same class of bug as users.googleId_1: unique app1DealId with nulls
   * makes the second "new property" listing fail E11000.
   */
  async onModuleInit() {
    try {
      const unset = await this.listingModel.collection.updateMany(
        { $or: [{ app1DealId: null }, { app1DealId: '' }] },
        { $unset: { app1DealId: '' } },
      )
      if (unset.modifiedCount > 0) {
        this.logger.log(`Unset empty app1DealId on ${unset.modifiedCount} listing(s)`)
      }

      const indexes = await this.listingModel.collection.indexes()
      const existing = indexes.find((idx) => idx.name === 'app1DealId_1')
      const wantsPartial =
        existing?.unique === true &&
        existing?.partialFilterExpression?.app1DealId?.$type === 'string'

      if (existing && !wantsPartial) {
        await this.listingModel.collection.dropIndex('app1DealId_1')
        this.logger.log('Dropped non-partial unique index app1DealId_1')
      }

      if (!wantsPartial) {
        await this.listingModel.collection.createIndex(
          { app1DealId: 1 },
          {
            unique: true,
            name: 'app1DealId_1',
            partialFilterExpression: { app1DealId: { $type: 'string' } },
          },
        )
        this.logger.log('Ensured partial unique index app1DealId_1')
      }
    } catch (err) {
      this.logger.error(
        'Failed to repair app1DealId unique index (new listings may 500):',
        err,
      )
    }
  }

  private async applyApp1MarketingProof(listing: ListingDocument): Promise<void> {
    const app1DealId = (listing.app1DealId ?? '').trim()
    if (!app1DealId) return

    listing.marketingProofSatisfiedByListing = true
    await listing.save()

    // If an App2 Deal already exists for this listing, satisfy marketing proof now.
    const deal = await this.dealModel.findOne({ listingId: listing._id })
    if (deal && !deal.marketingProofUploaded) {
      deal.marketingProofUploaded = true
      deal.marketingProofUrl = deal.marketingProofUrl || `app2-listing:${app1DealId}`
      deal.marketingProofDeadline = null
      await deal.save()
    }

    await this.app1BidsService.markMarketingComplete(
      app1DealId,
      `app2-listing:${listing._id.toString()}`,
    )
  }

  async uploadPhoto(
    wholesalerId: string,
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ): Promise<{ url: string }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Image file is required.')
    }
    if (!LISTING_PHOTO_MIME.has(file.mimetype)) {
      throw new BadRequestException('Photo must be a JPEG, PNG, WebP, or GIF image.')
    }
    if (file.size > MAX_LISTING_PHOTO_BYTES) {
      throw new BadRequestException('Photo must be 8MB or smaller.')
    }

    try {
      const uploaded = await this.cloudinaryService.uploadListingImage(
        file.buffer,
        `listings/${wholesalerId}`,
        file.originalname || 'listing.jpg',
      )
      return { url: uploaded.secure_url }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      this.logger.error('uploadPhoto failed:', err)
      throw new BadRequestException('Failed to upload listing photo.')
    }
  }

  // ── Profit Calculator ────────────────────────────────────────
  private calculateProfit(
    arv: number,
    purchasePrice: number,
    rehabTotal: number,
    estimatedHoldingCosts: number,
  ): number {
    return arv - purchasePrice - rehabTotal - estimatedHoldingCosts
  }

  // ── Outlier Check ────────────────────────────────────────────
  // If rehab < 5% of ARV → flag for admin review
  private isOutlier(arv: number, rehabTotal: number): boolean {
    if (arv <= 0) return false
    return rehabTotal < arv * 0.05
  }

  // ── Create Draft ─────────────────────────────────────────────
  async create(wholesalerId: string, dto: CreateListingDto): Promise<ListingDocument> {
    const rehabTotal = dto.rehabTotal ?? 0
    const arv = dto.arv ?? 0
    const purchase = dto.purchasePrice ?? 0
    const holding = dto.estimatedHoldingCosts ?? 0

    const projectedBuyerProfit = this.calculateProfit(arv, purchase, rehabTotal, holding)

    const outlierFlagged = arv > 0 ? this.isOutlier(arv, rehabTotal) : false

    // One listing per linked App1 deal — fail fast on the obvious double-submit
    // before touching App1; the partial unique index is the race backstop.
    if (dto.app1DealId) {
      const dup = await this.listingModel
        .exists({ app1DealId: dto.app1DealId })
        .exec()
      if (dup) {
        throw new ConflictException('A listing for this App1 deal already exists.')
      }
    }

    let listing: ListingDocument
    try {
      listing = await this.listingModel.create({
      wholesalerId: new Types.ObjectId(wholesalerId),
      dealType: dto.dealType,
      marketStatus: dto.marketStatus ?? 'off_market',
      propertyAddress: dto.propertyAddress ?? '',
      city: dto.city ?? '',
      stateCode: dto.stateCode ?? '',
      zipCode: dto.zipCode ?? '',
      arv,
      rehabBreakdown: dto.rehabBreakdown ?? {},
      rehabTotal,
      purchasePrice: purchase,
      estimatedHoldingCosts: holding,
      projectedBuyerProfit,
      assignmentFeeLow: dto.assignmentFeeLow ?? 0,
      assignmentFeeHigh: dto.assignmentFeeHigh ?? 0,
      photoUrls: Array.isArray(dto.photoUrls)
        ? dto.photoUrls.filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
        : [],
      videoUrl: typeof dto.videoUrl === 'string' ? dto.videoUrl.trim() : '',
      outlierFlagged,
      status: ListingStatus.DRAFT,
      ...(dto.app1DealId
        ? {
            app1DealId: dto.app1DealId,
            marketingProofSatisfiedByListing: true,
          }
        : {}),
      })
    } catch (err) {
      if (isMongoDuplicateKeyError(err)) {
        throw new ConflictException('A listing for this App1 deal already exists.')
      }
      if (
        err &&
        typeof err === 'object' &&
        (err as { name?: string }).name === 'ValidationError'
      ) {
        const errors = (err as { errors?: Record<string, { message?: string }> }).errors
        const msgs = errors
          ? Object.values(errors)
              .map((e) => e.message)
              .filter(Boolean)
          : []
        throw new BadRequestException(
          msgs.length ? msgs.join(' ') : 'Listing data is invalid.',
        )
      }
      this.logger.error('create listing failed:', err)
      throw err
    }

    if (outlierFlagged) {
      this.logger.warn(`Listing ${listing._id} flagged: rehab ${rehabTotal} < 5% of ARV ${arv}`)
    }

    if (listing.app1DealId) {
      await this.applyApp1MarketingProof(listing)
    }

    this.logger.log(`Listing created: ${listing._id} by ${wholesalerId}`)
    return listing
  }

  // ── Update Draft ─────────────────────────────────────────────
  async update(listingId: string, wholesalerId: string, dto: UpdateListingDto): Promise<ListingDocument> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId).select('+assignmentFeeLow')
    if (!listing) throw new NotFoundException('Listing not found.')

    if (listing.wholesalerId.toString() !== wholesalerId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    if (listing.status !== ListingStatus.DRAFT && listing.status !== ListingStatus.PENDING_REVIEW) {
      throw new ForbiddenException('Published listings cannot be edited.')
    }

    // Fee lock check — critical business rule
    if (
      listing.feeLocked &&
      (dto.assignmentFeeLow !== undefined || dto.assignmentFeeHigh !== undefined)
    ) {
      this.logger.warn(`Fee edit attempt on locked listing ${listingId} by ${wholesalerId}`)
      throw new ForbiddenException('Assignment fee cannot be changed after a bid is accepted.')
    }

    // Recalculate profit if financials changed
    const arv = dto.arv ?? listing.arv
    const rehab = dto.rehabTotal ?? listing.rehabTotal
    const purchase = dto.purchasePrice ?? listing.purchasePrice
    const holding = dto.estimatedHoldingCosts ?? listing.estimatedHoldingCosts

    const projectedBuyerProfit = this.calculateProfit(arv, purchase, rehab, holding)
    const outlierFlagged = arv > 0 ? this.isOutlier(arv, rehab) : listing.outlierFlagged

    const nextDto = { ...dto }
    if (Array.isArray(dto.photoUrls)) {
      nextDto.photoUrls = dto.photoUrls.filter(
        (u) => typeof u === 'string' && /^https?:\/\//i.test(u),
      )
    }
    if (typeof dto.videoUrl === 'string') {
      nextDto.videoUrl = dto.videoUrl.trim()
    }

    Object.assign(listing, {
      ...nextDto,
      projectedBuyerProfit,
      outlierFlagged,
    })

    await listing.save()
    return listing
  }

  // ── Publish ──────────────────────────────────────────────────
  async publish(listingId: string, wholesalerId: string): Promise<ListingDocument> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId).select('+assignmentFeeLow')
    if (!listing) throw new NotFoundException('Listing not found.')

    if (listing.wholesalerId.toString() !== wholesalerId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    if (listing.status !== ListingStatus.DRAFT) {
      throw new BadRequestException('Only draft listings can be published.')
    }

    // Validate required fields before publishing
    const missing: string[] = []
    if (!listing.propertyAddress) missing.push('propertyAddress')
    if (!listing.stateCode) missing.push('stateCode')
    if (!listing.zipCode) missing.push('zipCode')
    if (listing.arv <= 0) missing.push('arv')
    if (listing.assignmentFeeHigh <= 0) missing.push('assignmentFeeHigh')

    if (missing.length > 0) {
      throw new BadRequestException(`Complete required fields before publishing: ${missing.join(', ')}`)
    }

    // Outlier flag blocks publishing — admin must clear it
    if (listing.outlierFlagged) {
      throw new BadRequestException(
        'This listing is flagged for admin review due to an unusual rehab estimate. Please contact support.',
      )
    }

    // Transition to pending review
    // Admin must approve before listing goes live
    listing.status = ListingStatus.PENDING_REVIEW
    listing.complianceScannedAt = new Date()
    // publishedAt is set when admin approves
    // listing.status = ListingStatus.LIVE
    // listing.publishedAt = new Date()

    await listing.save()

    if (listing.app1DealId && !listing.marketingProofSatisfiedByListing) {
      await this.applyApp1MarketingProof(listing)
    }

    this.logger.log(`Listing ${listingId} published by ${wholesalerId}`)
    return listing
  }

  // ── Get Live Stream (Buyer View) ─────────────────────────────
  async findLive(query: QueryListingsDto): Promise<{ listings: unknown[]; total: number; page: number }> {
    const page = query.page ?? 1
    const limit = query.limit ?? 12
    const skip = (page - 1) * limit

    const filter: Record<string, unknown> = {
      status: ListingStatus.LIVE,
      bidsOpen: true,
    }

    if (query.stateCode) filter.stateCode = query.stateCode.toUpperCase()
    if (query.dealType) filter.dealType = query.dealType
    if (query.minProfit !== undefined) {
      filter.projectedBuyerProfit = { $gte: query.minProfit }
    }
    if (query.maxFee !== undefined) {
      filter.assignmentFeeHigh = { $lte: query.maxFee }
    }

    const [listings, total] = await Promise.all([
      this.listingModel
        .find(filter)
        .select('-assignmentFeeLow') // never expose to buyers
        .sort({ publishedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('wholesalerId', 'fullName reliabilityScore')
        .lean()
        .exec(),
      this.listingModel.countDocuments(filter).exec(),
    ])

    return { listings, total, page }
  }

  // ── Get One (with role-based field hiding) ───────────────────
  async findOne(
    listingId: string,
    requestingRole: string,
    userId?: string,
  ): Promise<unknown> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const isBuyer = requestingRole === UserRole.BUYER || requestingRole === UserRole.REALTOR

    let q = this.listingModel
      .findById(listingId)
      .populate('wholesalerId', 'fullName reliabilityScore')

    if (isBuyer) q = q.select('-assignmentFeeLow')
    else q = q.select('+assignmentFeeLow')

    const listing = await q.lean().exec()
    if (!listing) throw new NotFoundException('Listing not found.')

    const ownerId = listingOwnerId(listing.wholesalerId)
    const isOwner = Boolean(userId && ownerId === userId)
    const isAdmin = requestingRole === UserRole.ADMIN
    const isPublicLive = listing.status === ListingStatus.LIVE

    if (!isOwner && !isAdmin && !isPublicLive) {
      throw new NotFoundException('Listing not found.')
    }

    const sourceDealFellThrough = await this.checkSourceDealFellThrough(
      listing.app1DealId,
    )

    return {
      ...listing,
      sourceDealFellThrough,
    }
  }

  // ── Get Wholesaler's Own Listings ────────────────────────────
  async findMyListings(wholesalerId: string): Promise<unknown[]> {
    const listings = await this.listingModel
      .find({ wholesalerId: new Types.ObjectId(wholesalerId) })
      .select('+assignmentFeeLow')
      .sort({ createdAt: -1 })
      .lean()
      .exec()

    return Promise.all(
      listings.map(async (listing) => ({
        ...listing,
        sourceDealFellThrough: await this.checkSourceDealFellThrough(
          listing.app1DealId,
        ),
      })),
    )
  }

  // ── Admin: Get Pending Review ────────────────────────────────
  async findPendingReview(): Promise<unknown[]> {
    return this.listingModel
      .find({ status: ListingStatus.PENDING_REVIEW })
      .select('+assignmentFeeLow')
      .populate('wholesalerId', 'fullName email')
      .sort({ createdAt: 1 })
      .lean()
      .exec()
  }

  // ── Admin: Approve/Reject Compliance ────────────────────────
  async adminReview(
    listingId: string,
    action: 'approve' | 'reject',
    reason?: string,
  ): Promise<ListingDocument> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const now = new Date()
    const update =
      action === 'approve'
        ? {
            status: ListingStatus.LIVE,
            publishedAt: now,
            complianceScannedAt: now,
            outlierFlagged: false,
          }
        : {
            status: ListingStatus.CANCELLED,
          }

    const listing = await this.listingModel
      .findOneAndUpdate(
        { _id: listingId, status: ListingStatus.PENDING_REVIEW },
        { $set: update },
        { new: true },
      )
      .select('+assignmentFeeLow')
      .exec()

    if (!listing) {
      const existing = await this.listingModel.findById(listingId).select('status').lean().exec()
      if (!existing) throw new NotFoundException('Listing not found.')
      throw new BadRequestException(
        `Listing is not pending review (current status: ${existing.status}).`,
      )
    }

    this.logger.log(
      `Admin ${action}d listing ${listingId} → status=${listing.status}` +
        (reason ? `: ${reason}` : ''),
    )
    return listing
  }

  // ── Increment bid count (called by BidsService) ──────────────
  async incrementBidCount(listingId: string): Promise<void> {
    if (!Types.ObjectId.isValid(listingId)) return
    await this.listingModel.findByIdAndUpdate(listingId, { $inc: { bidCount: 1 } }).exec()
  }

  // ── Close bidding (called after 1-2-Delete selection) ───────
  async closeBidding(listingId: string): Promise<void> {
    if (!Types.ObjectId.isValid(listingId)) return
    await this.listingModel
      .findByIdAndUpdate(listingId, {
        bidsOpen: false,
        status: ListingStatus.UNDER_CONTRACT,
      })
      .exec()
  }

  /** When the 10-bid cap is reached — stop new bids without marking under contract */
  async freezeBiddingAtCap(listingId: string): Promise<void> {
    if (!Types.ObjectId.isValid(listingId)) return
    await this.listingModel.findByIdAndUpdate(listingId, { bidsOpen: false }).exec()
  }

  /**
   * Internal: map an App1 closed-deal id to App2 listing/deal pipeline status.
   * Sold is driven by Listing.status === closed (set when the App2 deal reaches funded_closed).
   * Cancelled is a distinct fifth status — not folded into marketing_pending/listed.
   * If the App1 source deal fell through after an App2 listing was created, that wins.
   */
  async getStatusByApp1DealId(app1DealId: string): Promise<App1DealListingStatusDto> {
    const id = (app1DealId ?? '').trim()
    if (!id) {
      return { status: 'marketing_pending' }
    }

    const listing = await this.listingModel.findOne({ app1DealId: id }).lean()
    if (!listing) {
      return { status: 'marketing_pending' }
    }

    const listingId = String(listing._id)

    if (await this.checkSourceDealFellThrough(id)) {
      return { status: 'source_deal_fell_through', listingId }
    }

    if (listing.status === ListingStatus.CANCELLED) {
      return { status: 'cancelled', listingId }
    }

    if (listing.status === ListingStatus.CLOSED) {
      const deal = await this.dealModel.findOne({ listingId: listing._id }).lean()
      const closedAt =
        deal?.closedAt instanceof Date
          ? deal.closedAt.toISOString()
          : deal?.closedAt
            ? new Date(deal.closedAt).toISOString()
            : null

      return {
        status: 'sold',
        listingId,
        dealId: deal ? String(deal._id) : '',
        closedAt,
      }
    }

    const deal = await this.dealModel.findOne({ listingId: listing._id }).lean()

    if (deal) {
      return {
        status: 'under_contract',
        listingId,
        dealId: String(deal._id),
        currentStep: deal.currentStep,
        titleRepAssigned: Boolean(deal.titleRepId),
      }
    }

    const preDealStatuses: ListingStatus[] = [
      ListingStatus.DRAFT,
      ListingStatus.PENDING_REVIEW,
      ListingStatus.LIVE,
    ]

    if (preDealStatuses.includes(listing.status as ListingStatus)) {
      return {
        status: 'listed',
        listingId,
        listingStatus: listing.status,
      }
    }

    // e.g. under_contract with no Deal document yet — still surface as listed with raw status
    return {
      status: 'listed',
      listingId,
      listingStatus: listing.status,
    }
  }

  private async checkSourceDealFellThrough(
    app1DealId: string | null | undefined,
  ): Promise<boolean> {
    const id = (app1DealId ?? '').trim()
    if (!id) return false

    const app1Status = await this.app1BidsService.getDealStatus(id)
    return this.app1BidsService.isSourceDealFellThrough(app1Status?.status)
  }
}
