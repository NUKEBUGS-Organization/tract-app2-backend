import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Listing, ListingDocument } from './schemas/listing.schema'
import { CreateListingDto } from './dto/create-listing.dto'
import { UpdateListingDto } from './dto/update-listing.dto'
import { QueryListingsDto } from './dto/query-listings.dto'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { UserRole } from '../../common/enums/user-role.enum'

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name)

  constructor(
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
  ) {}

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

    const listing = await this.listingModel.create({
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
      outlierFlagged,
      status: ListingStatus.DRAFT,
    })

    if (outlierFlagged) {
      this.logger.warn(`Listing ${listing._id} flagged: rehab ${rehabTotal} < 5% of ARV ${arv}`)
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

    Object.assign(listing, {
      ...dto,
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
  async findOne(listingId: string, requestingRole: string): Promise<unknown> {
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

    return listing
  }

  // ── Get Wholesaler's Own Listings ────────────────────────────
  async findMyListings(wholesalerId: string): Promise<unknown[]> {
    return this.listingModel
      .find({ wholesalerId: new Types.ObjectId(wholesalerId) })
      .select('+assignmentFeeLow')
      .sort({ createdAt: -1 })
      .lean()
      .exec()
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

    const listing = await this.listingModel.findById(listingId).select('+assignmentFeeLow')
    if (!listing) throw new NotFoundException('Listing not found.')

    if (listing.status !== ListingStatus.PENDING_REVIEW) {
      throw new BadRequestException('Listing is not pending review.')
    }

    if (action === 'approve') {
      listing.status = ListingStatus.LIVE
      listing.publishedAt = new Date()
      listing.complianceScannedAt = new Date()
    } else {
      listing.status = ListingStatus.CANCELLED
    }

    await listing.save()
    this.logger.log(`Admin ${action}d listing ${listingId}` + (reason ? `: ${reason}` : ''))
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
}
