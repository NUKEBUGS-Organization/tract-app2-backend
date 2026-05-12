import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types, type AnyBulkWriteOperation } from 'mongoose'
import { Bid, BidDocument } from './schemas/bid.schema'
import { CreateBidDto } from './dto/create-bid.dto'
import { SelectBidsDto } from './dto/select-bids.dto'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { ListingsService } from '../listings/listings.service'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { AppGateway } from '../gateway/app.gateway'
import { SOCKET_EVENTS } from '../gateway/socket-events.constants'

const MAX_BIDS = 10

@Injectable()
export class BidsService {
  private readonly logger = new Logger(BidsService.name)

  constructor(
    @InjectModel(Bid.name)
    private readonly bidModel: Model<BidDocument>,
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    private readonly listingsService: ListingsService,
    private readonly gateway: AppGateway,
  ) {}

  // ── Place a bid ───────────────────────────────────────────────
  async placeBid(buyerId: string, dto: CreateBidDto): Promise<BidDocument> {
    if (!Types.ObjectId.isValid(dto.listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    // 1. Fetch listing with assignmentFeeLow for reserve check
    const listing = await this.listingModel
      .findById(dto.listingId)
      .select('+assignmentFeeLow')
      .lean()

    if (!listing) {
      throw new NotFoundException('Listing not found.')
    }

    // 2. Check listing is live and accepting bids
    if (listing.status !== ListingStatus.LIVE) {
      throw new BadRequestException('This listing is not currently accepting bids.')
    }

    if (!listing.bidsOpen) {
      throw new BadRequestException('Bidding is closed for this listing.')
    }

    // 3. Enforce 10-bid cap
    if (listing.bidCount >= MAX_BIDS) {
      throw new BadRequestException(
        'This listing has reached the maximum of 10 bids. No more bids can be accepted.',
      )
    }

    // 4. Check buyer has not already bid on this listing
    const existing = await this.bidModel.findOne({
      listingId: new Types.ObjectId(dto.listingId),
      buyerId: new Types.ObjectId(buyerId),
    })
    if (existing) {
      throw new ConflictException('You have already placed a bid on this listing.')
    }

    // 5. Hidden reserve check
    const feeLow = listing.assignmentFeeLow ?? 0
    const isAboveReserve = feeLow > 0 ? dto.assignmentPrice >= feeLow : true

    if (!isAboveReserve) {
      throw new BadRequestException(
        'Your bid does not meet the minimum acceptable price for this listing.',
      )
    }

    // 6. Create the bid
    const bid = await this.bidModel.create({
      listingId: new Types.ObjectId(dto.listingId),
      buyerId: new Types.ObjectId(buyerId),
      assignmentPrice: dto.assignmentPrice,
      specialTerms: dto.specialTerms ?? '',
      isAboveReserve,
      commissionPct: dto.commissionPct ?? null,
      agencyRole: dto.agencyRole ?? null,
      feePaidBy: dto.feePaidBy ?? null,
      status: BidStatus.ACTIVE,
      submittedAt: new Date(),
    })

    // 7. Increment bid count on listing
    await this.listingsService.incrementBidCount(dto.listingId)

    // 8. Auto-close if now at 10 (board full — not yet under contract)
    const newCount = listing.bidCount + 1
    if (newCount >= MAX_BIDS) {
      await this.listingsService.freezeBiddingAtCap(dto.listingId)
      this.logger.log(`Listing ${dto.listingId} reached 10-bid cap — bidding closed.`)
    }

    this.gateway.emitToListing(dto.listingId, SOCKET_EVENTS.BID_PLACED, {
      listingId: dto.listingId,
      bidCount: newCount,
      bidsOpen: newCount < MAX_BIDS,
    })

    this.gateway.emitToListing(dto.listingId, SOCKET_EVENTS.BID_COUNT_UPDATED, {
      listingId: dto.listingId,
      bidCount: newCount,
    })

    if (newCount >= MAX_BIDS) {
      this.gateway.emitToListing(dto.listingId, SOCKET_EVENTS.LISTING_CLOSED, {
        listingId: dto.listingId,
      })
    }

    this.logger.log(
      `Bid placed: ${bid._id} on listing ${dto.listingId} by ${buyerId} for $${dto.assignmentPrice}`,
    )

    return bid
  }

  // ── Get bids for a listing (Wholesaler view) ──────────────────
  async getBidsForListing(
    listingId: string,
    userId: string,
    role: UserRole | string,
  ): Promise<unknown[]> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId)
    if (!listing) throw new NotFoundException('Listing not found.')

    if (role !== UserRole.ADMIN && listing.wholesalerId.toString() !== userId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    return this.bidModel
      .find({ listingId: new Types.ObjectId(listingId) })
      .populate('buyerId', 'fullName reliabilityScore')
      .sort({ assignmentPrice: -1 })
      .lean()
      .exec()
  }

  // ── Get buyer's own bids ──────────────────────────────────────
  async getMyBids(buyerId: string): Promise<unknown[]> {
    return this.bidModel
      .find({ buyerId: new Types.ObjectId(buyerId) })
      .populate('listingId', 'propertyAddress stateCode status dealType')
      .sort({ createdAt: -1 })
      .lean()
      .exec()
  }

  // ── THE 1-2-DELETE RULE ───────────────────────────────────────
  async selectBids(
    listingId: string,
    wholesalerId: string,
    dto: SelectBidsDto,
  ): Promise<{ primary: unknown; backups: unknown[] }> {
    if (!Types.ObjectId.isValid(listingId)) {
      throw new NotFoundException('Listing not found.')
    }

    const listing = await this.listingModel.findById(listingId)
    if (!listing) throw new NotFoundException('Listing not found.')

    if (listing.wholesalerId.toString() !== wholesalerId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    if (listing.status !== ListingStatus.LIVE) {
      throw new BadRequestException('Bids can only be selected on a live listing.')
    }

    const backupIds = dto.backupBidIds ?? []
    if (backupIds.length > 2) {
      throw new BadRequestException('Maximum 2 backup bids allowed.')
    }

    const backupSet = new Set(backupIds)
    if (backupSet.size !== backupIds.length) {
      throw new BadRequestException('Backup bid IDs must be unique.')
    }

    if (backupIds.includes(dto.primaryBidId)) {
      throw new BadRequestException('Primary bid cannot also be listed as a backup.')
    }

    const allBids = await this.bidModel.find({
      listingId: new Types.ObjectId(listingId),
    })

    if (allBids.length === 0) {
      throw new BadRequestException('No bids found for this listing.')
    }

    const primaryBid = allBids.find((b) => b._id.toString() === dto.primaryBidId)
    if (!primaryBid) {
      throw new NotFoundException('Primary bid not found.')
    }

    const backupBids = backupIds.map((id, idx) => {
      const bid = allBids.find((b) => b._id.toString() === id)
      if (!bid) {
        throw new NotFoundException(`Backup bid ${id} not found.`)
      }
      return { bid, position: idx + 2 }
    })

    const bulkOps: AnyBulkWriteOperation<BidDocument>[] = allBids.map((bid) => {
      const id = bid._id.toString()

      if (id === dto.primaryBidId) {
        return {
          updateOne: {
            filter: { _id: bid._id },
            update: {
              $set: {
                status: BidStatus.PRIMARY,
                backupPosition: null,
              },
            },
          },
        }
      }

      const backupEntry = backupBids.find((b) => b.bid._id.toString() === id)
      if (backupEntry) {
        return {
          updateOne: {
            filter: { _id: bid._id },
            update: {
              $set: {
                status:
                  backupEntry.position === 2 ? BidStatus.BACKUP_2 : BidStatus.BACKUP_3,
                backupPosition: backupEntry.position,
              },
            },
          },
        }
      }

      return {
        updateOne: {
          filter: { _id: bid._id },
          update: { $set: { status: BidStatus.WORKING, backupPosition: null } },
        },
      }
    })

    await this.bidModel.bulkWrite(bulkOps)

    await this.listingModel
      .findByIdAndUpdate(listingId, {
        feeLocked: true,
        bidsOpen: false,
        status: ListingStatus.UNDER_CONTRACT,
      })
      .exec()

    const [updatedPrimary, ...updatedBackups] = await Promise.all([
      this.bidModel.findById(primaryBid._id).populate('buyerId', 'fullName reliabilityScore').lean().exec(),
      ...backupBids.map((b) =>
        this.bidModel.findById(b.bid._id).populate('buyerId', 'fullName reliabilityScore').lean().exec(),
      ),
    ])

    this.logger.log(
      `1-2-DELETE applied on listing ${listingId}: primary=${dto.primaryBidId} backups=[${backupIds.join(', ')}] working=${allBids.length - 1 - backupIds.length} bids`,
    )

    return {
      primary: updatedPrimary,
      backups: updatedBackups,
    }
  }

  // ── Reject a single bid ───────────────────────────────────────
  async rejectBid(bidId: string, wholesalerId: string): Promise<BidDocument> {
    if (!Types.ObjectId.isValid(bidId)) {
      throw new NotFoundException('Bid not found.')
    }

    const bid = await this.bidModel.findById(bidId)
    if (!bid) throw new NotFoundException('Bid not found.')

    const listing = await this.listingModel.findById(bid.listingId)
    if (!listing) throw new NotFoundException('Listing not found.')

    if (listing.wholesalerId.toString() !== wholesalerId) {
      throw new ForbiddenException('You do not own this listing.')
    }

    bid.status = BidStatus.REJECTED
    await bid.save()
    return bid
  }
}
