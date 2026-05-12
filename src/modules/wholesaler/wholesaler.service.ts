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
import { User, UserDocument } from '../users/schemas/user.schema'
import type { WholesalerDashboardResponseDto } from './dto/wholesaler-dashboard.dto'
import { DealStep } from '../../common/enums/deal-step.enum'
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

function hoursFromNow(date: Date): number {
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 3_600_000))
}

function formatHoursLabel(hours: number): string {
  if (hours <= 0) return 'Expired'
  if (hours < 1) return '< 1h remaining'
  if (hours < 24) return `${hours}h remaining`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem}h remaining` : `${days}d remaining`
}

function scoreTier(score: number): string {
  if (score >= 85) return 'Elite'
  if (score >= 70) return 'Good Standing'
  if (score >= 50) return 'At Risk'
  if (score >= 30) return 'Restricted'
  return 'Banned'
}

type ListingLean = {
  _id: Types.ObjectId
  propertyAddress?: string
  city?: string
  stateCode?: string
  photoUrls?: string[]
}

type DealAggRow = {
  _id: Types.ObjectId
  listingId: Types.ObjectId
  currentStep: DealStep
  marketingProofDeadline: Date | null
  marketingProofUploaded: boolean
  createdAt: Date
  listing?: ListingLean | null
}

@Injectable()
export class WholesalerService {
  private readonly logger = new Logger(WholesalerService.name)

  constructor(
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async getDashboard(wholesalerId: string): Promise<WholesalerDashboardResponseDto> {
    try {
      if (!Types.ObjectId.isValid(wholesalerId)) {
        throw new NotFoundException('Wholesaler not found.')
      }
      const wId = new Types.ObjectId(wholesalerId)

      const [user, listings, activeDeals] = await Promise.all([
        this.userModel.findById(wId).lean(),
        this.listingModel.find({ wholesalerId: wId }).sort({ createdAt: -1 }).lean(),
        this.dealModel
          .aggregate<DealAggRow>([
            {
              $match: {
                wholesalerId: wId,
                currentStep: { $ne: DealStep.FUNDED_CLOSED },
              },
            },
            {
              $lookup: {
                from: 'listings',
                localField: 'listingId',
                foreignField: '_id',
                as: '_listing',
              },
            },
            {
              $addFields: {
                listing: { $arrayElemAt: ['$_listing', 0] },
              },
            },
            { $project: { _listing: 0 } },
            { $sort: { createdAt: -1 } },
          ])
          .exec(),
      ])

      if (!user) {
        throw new NotFoundException('Wholesaler not found.')
      }

      const liveListings = listings.filter((l) => l.status === ListingStatus.LIVE)
      const totalBidsReceived = liveListings.reduce((sum, l) => sum + (l.bidCount ?? 0), 0)

      const killSwitchAlerts = activeDeals.filter((d) => {
        if (d.marketingProofUploaded) return false
        if (!d.marketingProofDeadline) return false
        return hoursFromNow(new Date(d.marketingProofDeadline)) < 24
      }).length

      const stats = {
        activeDeals: activeDeals.length,
        myListings: listings.length,
        totalBidsReceived,
        reliabilityScore: user.reliabilityScore ?? 100,
        reliabilityTier: scoreTier(user.reliabilityScore ?? 100),
        killSwitchAlerts,
      }

      let killSwitch: WholesalerDashboardResponseDto['killSwitch'] = null
      const urgentDeals = activeDeals
        .filter((d) => {
          if (d.marketingProofUploaded) return false
          if (!d.marketingProofDeadline) return false
          return hoursFromNow(new Date(d.marketingProofDeadline)) < 24
        })
        .sort((a, b) => {
          const aH = hoursFromNow(new Date(a.marketingProofDeadline!))
          const bH = hoursFromNow(new Date(b.marketingProofDeadline!))
          return aH - bH
        })

      if (urgentDeals.length > 0) {
        const urgent = urgentDeals[0]
        const hoursLeft = hoursFromNow(new Date(urgent.marketingProofDeadline!))
        const listing = urgent.listing
        killSwitch = {
          dealId: urgent._id.toString(),
          listingId: listing?._id?.toString() ?? '',
          headline: 'Action Required',
          detailLine:
            hoursLeft === 0
              ? 'Marketing proof deadline has passed!'
              : `Upload marketing proof in ${formatHoursLabel(hoursLeft)}`,
          timerLabel: formatHoursLabel(hoursLeft),
          hoursLeft,
        }
      }

      const pipeline = activeDeals.map((deal) => {
        const listing = deal.listing
        const address = listing?.propertyAddress ?? ''
        const city = listing?.city ?? ''
        const state = listing?.stateCode ?? ''
        const imageUrl = listing?.photoUrls?.[0] ?? ''
        const propertyLine = [address, city, state].filter(Boolean).join(', ')

        const hasDeadline = !!deal.marketingProofDeadline
        const deadlineDate = hasDeadline ? new Date(deal.marketingProofDeadline!) : null
        const hoursLeft = deadlineDate ? hoursFromNow(deadlineDate) : null

        const needsProof =
          !deal.marketingProofUploaded && hasDeadline && hoursLeft !== null && hoursLeft < 72

        const timerTone: 'green' | 'red' = hoursLeft !== null && hoursLeft < 12 ? 'red' : 'green'

        const timerLabel = deadlineDate
          ? formatHoursLabel(hoursLeft!)
          : (STEP_LABELS[deal.currentStep as DealStep] ?? deal.currentStep)

        return {
          id: deal._id.toString(),
          listingId: listing?._id?.toString() ?? '',
          propertyLine,
          portfolioRef: `Deal #${deal._id.toString().slice(-4).toUpperCase()}`,
          imageUrl,
          status: needsProof ? 'action_required' : 'under_contract',
          currentStep: deal.currentStep,
          stepLabel: STEP_LABELS[deal.currentStep as DealStep] ?? deal.currentStep,
          timerLabel,
          timerTone,
          timerPulse: timerTone === 'red',
          primaryAction: needsProof ? ('upload' as const) : ('view' as const),
          marketingProofUploaded: deal.marketingProofUploaded ?? false,
          marketingProofDeadline: deal.marketingProofDeadline
            ? new Date(deal.marketingProofDeadline).toISOString()
            : null,
        }
      })

      const activeListings = listings
        .filter(
          (l) =>
            l.status === ListingStatus.LIVE ||
            l.status === ListingStatus.DRAFT ||
            l.status === ListingStatus.PENDING_REVIEW,
        )
        .slice(0, 6)
        .map((l) => ({
          id: l._id.toString(),
          address: l.propertyAddress ?? '',
          city: l.city ?? '',
          stateCode: l.stateCode ?? '',
          imageUrl: l.photoUrls?.[0] ?? '',
          status: l.status,
          bidCount: l.bidCount ?? 0,
          arv: l.arv ?? 0,
          assignmentFeeHigh: l.assignmentFeeHigh ?? 0,
          projectedBuyerProfit: l.projectedBuyerProfit ?? 0,
          publishedAt: l.publishedAt ? new Date(l.publishedAt).toISOString() : null,
          bidsOpen: l.bidsOpen ?? false,
        }))

      this.logger.log(
        `Dashboard fetched for wholesaler ${wholesalerId}: ${activeDeals.length} deals, ${listings.length} listings`,
      )

      return { stats, killSwitch, pipeline, listings: activeListings }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error(`getDashboard failed for ${wholesalerId}:`, err)
      throw new InternalServerErrorException('Failed to load dashboard. Please try again.')
    }
  }
}
