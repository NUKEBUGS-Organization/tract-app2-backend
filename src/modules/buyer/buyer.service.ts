import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { User, UserDocument } from '../users/schemas/user.schema'
import type { BuyerDashboardResponseDto } from './dto/buyer-dashboard.dto'
import { DealStep, STEP_ORDER } from '../../common/enums/deal-step.enum'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'

const STEP_LABELS: Record<DealStep, string> = {
  [DealStep.CONTRACT_SIGNED]: 'Contract Signed',
  [DealStep.EMD_DEPOSITED]: 'EMD Deposited',
  [DealStep.INSPECTION_PERIOD]: 'Inspection Phase',
  [DealStep.APPRAISAL_ORDERED]: 'Appraisal Ordered',
  [DealStep.FINANCING_APPROVED]: 'Financing Approved',
  [DealStep.TITLE_SEARCH_COMPLETE]: 'Title Search',
  [DealStep.CLEAR_TO_CLOSE]: 'Clear to Close',
  [DealStep.FUNDED_CLOSED]: 'Funded & Closed',
}

const BID_STATUS_LABELS: Record<string, string> = {
  [BidStatus.ACTIVE]: 'Active',
  [BidStatus.PRIMARY]: 'Under Contract ★',
  [BidStatus.BACKUP_2]: 'Backup #2',
  [BidStatus.BACKUP_3]: 'Backup #3',
  [BidStatus.WORKING]: 'Working',
  [BidStatus.REJECTED]: 'Rejected',
}

function scoreTier(score: number): string {
  if (score >= 85) return 'Elite'
  if (score >= 70) return 'Good Standing'
  if (score >= 50) return 'At Risk'
  if (score >= 30) return 'Restricted'
  return 'Banned'
}

type LeanBid = Bid & {
  _id: Types.ObjectId
  createdAt?: Date
  listingId?: Types.ObjectId | (Listing & { _id: Types.ObjectId }) | null
}

type LeanDeal = Deal & {
  _id: Types.ObjectId
  listingId?: Types.ObjectId | (Listing & { _id: Types.ObjectId }) | null
  wholesalerId?: Types.ObjectId | (User & { _id: Types.ObjectId; fullName?: string }) | null
}

@Injectable()
export class BuyerService {
  private readonly logger = new Logger(BuyerService.name)

  constructor(
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Bid.name)
    private readonly bidModel: Model<BidDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async getDashboard(buyerId: string): Promise<BuyerDashboardResponseDto> {
    try {
      if (!Types.ObjectId.isValid(buyerId)) {
        throw new NotFoundException('Buyer not found.')
      }
      const bId = new Types.ObjectId(buyerId)

      const [user, myBids, myDeals, recommended] = await Promise.all([
        this.userModel.findById(bId).lean(),
        this.bidModel
          .find({ buyerId: bId })
          .populate('listingId', 'propertyAddress city stateCode photoUrls status dealType')
          .sort({ createdAt: -1 })
          .lean() as Promise<LeanBid[]>,
        this.dealModel
          .find({
            primaryBuyerId: bId,
            currentStep: { $nin: [DealStep.FUNDED_CLOSED] },
          })
          .populate('listingId', 'propertyAddress city stateCode photoUrls')
          .populate('wholesalerId', 'fullName')
          .sort({ createdAt: -1 })
          .lean() as Promise<LeanDeal[]>,
        this.listingModel
          .find({
            status: ListingStatus.LIVE,
            bidsOpen: true,
          })
          .select('-assignmentFeeLow')
          .sort({ publishedAt: -1, createdAt: -1 })
          .limit(24)
          .lean(),
      ])

      if (!user) {
        throw new NotFoundException('Buyer not found.')
      }

      const biddedListingIds = new Set(
        myBids
          .map((b) => {
            const l = b.listingId as Listing & { _id?: Types.ObjectId } | undefined
            if (l && typeof l === 'object' && '_id' in l && l._id) return l._id.toString()
            if (b.listingId instanceof Types.ObjectId) return b.listingId.toString()
            return null
          })
          .filter((x): x is string => Boolean(x)),
      )

      const filteredRecommended = recommended.filter((l) => !biddedListingIds.has(l._id.toString())).slice(0, 4)

      const activeBidsCount = myBids.filter((b) =>
        [BidStatus.ACTIVE, BidStatus.PRIMARY, BidStatus.BACKUP_2, BidStatus.BACKUP_3].includes(
          b.status as BidStatus,
        ),
      ).length

      const stats = {
        activeBids: activeBidsCount,
        dealsInProgress: myDeals.length,
        dealsClosed: user.app2_totalDealsClosed ?? 0,
        reliabilityScore: user.reliabilityScore ?? 100,
        reliabilityTier: scoreTier(user.reliabilityScore ?? 100),
        isVettedBuyer: user.app2_isVettedBuyer ?? false,
      }

      const activeBids = myBids
        .filter((b) => b.status !== BidStatus.REJECTED)
        .slice(0, 5)
        .map((bid) => {
          const listing = bid.listingId as Listing & { _id?: Types.ObjectId } | undefined
          const address = listing?.propertyAddress ?? ''
          const city = listing?.city ?? ''
          const state = listing?.stateCode ?? ''
          const isDeal = bid.status === BidStatus.PRIMARY
          const relDeal = myDeals.find((d) => d.primaryBidId?.toString() === bid._id.toString())
          const created = bid.createdAt instanceof Date ? bid.createdAt : new Date()

          return {
            id: bid._id.toString(),
            listingId: listing?._id?.toString() ?? '',
            propertyLine: address,
            city,
            stateCode: state,
            imageUrl: listing?.photoUrls?.[0] ?? '',
            assignmentPrice: bid.assignmentPrice,
            status: bid.status,
            statusLabel: BID_STATUS_LABELS[bid.status] ?? bid.status,
            submittedAt: created.toISOString(),
            action: isDeal ? ('deal' as const) : ('view' as const),
            dealId: relDeal?._id?.toString() ?? null,
          }
        })

      const activeDeals = myDeals.map((deal) => {
        const listing = deal.listingId as Listing & { _id?: Types.ObjectId } | undefined
        const wholesaler = deal.wholesalerId as User & { fullName?: string } | undefined
        const address = listing?.propertyAddress ?? ''
        const city = listing?.city ?? ''
        const state = listing?.stateCode ?? ''
        const rawIdx = STEP_ORDER.indexOf(deal.currentStep as DealStep)
        const stepIdx = rawIdx >= 0 ? rawIdx : 0

        return {
          id: deal._id.toString(),
          listingId: listing?._id?.toString() ?? '',
          propertyLine: address,
          city,
          stateCode: state,
          imageUrl: listing?.photoUrls?.[0] ?? '',
          currentStep: deal.currentStep,
          stepLabel: STEP_LABELS[deal.currentStep as DealStep] ?? deal.currentStep,
          stepNumber: stepIdx + 1,
          totalSteps: STEP_ORDER.length,
          emdStatus: deal.emdStatus ?? 'pending',
          emdAmount: deal.emdAmount ?? 0,
          wholesalerName: wholesaler?.fullName ?? 'Wholesaler',
        }
      })

      const recommendedListings = filteredRecommended.map((l) => ({
        id: l._id.toString(),
        propertyAddress: l.propertyAddress ?? '',
        city: l.city ?? '',
        stateCode: l.stateCode ?? '',
        imageUrl: l.photoUrls?.[0] ?? '',
        dealType: l.dealType ?? '',
        arv: l.arv ?? 0,
        rehabTotal: l.rehabTotal ?? 0,
        assignmentFeeHigh: l.assignmentFeeHigh ?? 0,
        projectedBuyerProfit: l.projectedBuyerProfit ?? 0,
        bidCount: l.bidCount ?? 0,
        bidsOpen: l.bidsOpen ?? false,
        publishedAt: l.publishedAt instanceof Date ? l.publishedAt.toISOString() : null,
      }))

      this.logger.log(
        `Buyer dashboard fetched for ${buyerId}: ${activeBidsCount} bids, ${myDeals.length} deals, ${filteredRecommended.length} recommended`,
      )

      return {
        stats,
        activeBids,
        activeDeals,
        recommendedListings,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error(`getDashboard failed for buyer ${buyerId}:`, err)
      throw new InternalServerErrorException('Failed to load dashboard. Please try again.')
    }
  }
}
