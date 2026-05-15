import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import type { TitleDashboardResponseDto } from './dto/title-dashboard.dto'
import { DealStep, STEP_ORDER, TITLE_REP_STEPS } from '../../common/enums/deal-step.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'

const STEP_LABELS: Record<DealStep, string> = {
  [DealStep.CONTRACT_SIGNED]: 'Step 1: Contract Signed',
  [DealStep.EMD_DEPOSITED]: 'Step 2: EMD Deposited',
  [DealStep.INSPECTION_PERIOD]: 'Step 3: Inspection',
  [DealStep.APPRAISAL_ORDERED]: 'Step 4: Appraisal',
  [DealStep.FINANCING_APPROVED]: 'Step 5: Financing',
  [DealStep.TITLE_SEARCH_COMPLETE]: 'Step 6: Title Search',
  [DealStep.CLEAR_TO_CLOSE]: 'Step 7: Clear to Close',
  [DealStep.FUNDED_CLOSED]: 'Step 8: Funded & Closed',
}

const NEXT_ACTION_LABELS: Record<DealStep, string> = {
  [DealStep.CONTRACT_SIGNED]: 'Waiting for EMD',
  [DealStep.EMD_DEPOSITED]: 'Waiting for buyer',
  [DealStep.INSPECTION_PERIOD]: 'Waiting for inspection',
  [DealStep.APPRAISAL_ORDERED]: 'Order appraisal',
  [DealStep.FINANCING_APPROVED]: 'Confirm financing',
  [DealStep.TITLE_SEARCH_COMPLETE]: 'Complete title search',
  [DealStep.CLEAR_TO_CLOSE]: 'Issue clear to close',
  [DealStep.FUNDED_CLOSED]: 'Deal closed',
}

const ADVANCE_LABELS: Partial<Record<DealStep, string>> = {
  [DealStep.INSPECTION_PERIOD]: 'Advance to Appraisal',
  [DealStep.APPRAISAL_ORDERED]: 'Advance to Financing',
  [DealStep.FINANCING_APPROVED]: 'Advance to Title Search',
  [DealStep.TITLE_SEARCH_COMPLETE]: 'Issue Clear to Close',
  [DealStep.CLEAR_TO_CLOSE]: 'Mark Funded & Closed',
}

/** CTC issued in the last 7 days — pipeline “closing this week” signal */
function isClosingThisWeek(deal: { currentStep: DealStep; clearToCloseAt?: Date | null }): boolean {
  if (deal.currentStep !== DealStep.CLEAR_TO_CLOSE) return false
  const ctc = deal.clearToCloseAt
  if (!(ctc instanceof Date) || Number.isNaN(ctc.getTime())) return false
  const ms = Date.now() - ctc.getTime()
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  return ms >= 0 && ms <= oneWeek
}

@Injectable()
export class TitleService {
  private readonly logger = new Logger(TitleService.name)

  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Listing.name) private readonly listingModel: Model<ListingDocument>,
  ) {}

  async getDashboard(titleRepId: string): Promise<TitleDashboardResponseDto> {
    try {
      if (!Types.ObjectId.isValid(titleRepId)) {
        throw new NotFoundException('Title representative not found.')
      }
      const tId = new Types.ObjectId(titleRepId)

      const deals = await this.dealModel
        .find({
          titleRepId: tId,
          currentStep: { $nin: [DealStep.FUNDED_CLOSED] },
        })
        .populate('listingId', 'propertyAddress city stateCode photoUrls')
        .populate('primaryBuyerId', 'fullName')
        .populate('wholesalerId', 'fullName')
        .sort({ createdAt: -1 })
        .lean()

      const pendingEmdCount = deals.filter((d) => d.emdStatus === 'pending').length
      const closingThisWeek = deals.filter((d) => isClosingThisWeek(d as Deal))
      const needsAction = deals.filter((d) => TITLE_REP_STEPS.has(d.currentStep as DealStep))

      const stats = {
        activeDeals: deals.length,
        pendingEmds: pendingEmdCount,
        closingThisWeek: closingThisWeek.length,
        dealsNeedingAction: needsAction.length,
      }

      const activeDeals = deals.map((deal) => {
        const listing = deal.listingId as unknown as (Listing & { _id?: Types.ObjectId }) | undefined
        const buyer = deal.primaryBuyerId as unknown as { fullName?: string; _id?: Types.ObjectId } | undefined
        const wholesaler = deal.wholesalerId as unknown as { fullName?: string; _id?: Types.ObjectId } | undefined
        const step = deal.currentStep as DealStep
        const rawIdx = STEP_ORDER.indexOf(step)
        const stepIdx = rawIdx >= 0 ? rawIdx : 0
        const isTitleStep = TITLE_REP_STEPS.has(step)
        const ctc = (deal as Deal & { clearToCloseAt?: Date | null }).clearToCloseAt

        return {
          id: deal._id.toString(),
          listingId: listing?._id?.toString() ?? '',
          propertyLine: listing?.propertyAddress ?? '—',
          city: listing?.city ?? '',
          stateCode: listing?.stateCode ?? '',
          buyerName: buyer?.fullName ?? 'Buyer',
          wholesalerName: wholesaler?.fullName ?? 'Wholesaler',
          currentStep: step,
          stepLabel: STEP_LABELS[step] ?? step,
          stepNumber: stepIdx + 1,
          totalSteps: STEP_ORDER.length,
          nextAction: NEXT_ACTION_LABELS[step] ?? '—',
          needsAction: isTitleStep,
          advanceLabel: ADVANCE_LABELS[step] ?? null,
          emdStatus: deal.emdStatus ?? 'pending',
          emdAmount: deal.emdAmount ?? 0,
          closingDate: ctc instanceof Date ? ctc.toISOString() : null,
        }
      })

      const pendingEmdsMapped = deals
        .filter((d) => d.emdStatus === 'pending' || d.emdStatus === 'deposited')
        .map((deal) => {
          const listing = deal.listingId as unknown as (Listing & { _id?: Types.ObjectId }) | undefined
          const buyer = deal.primaryBuyerId as unknown as { fullName?: string } | undefined
          return {
            dealId: deal._id.toString(),
            propertyLine: listing?.propertyAddress ?? '—',
            buyerName: buyer?.fullName ?? 'Buyer',
            emdAmount: deal.emdAmount ?? 0,
            emdStatus: deal.emdStatus ?? 'pending',
            depositedAt: deal.emdDepositedAt instanceof Date ? deal.emdDepositedAt.toISOString() : null,
          }
        })

      this.logger.log(`Title rep dashboard fetched for ${titleRepId}: ${deals.length} deals`)

      return {
        stats,
        activeDeals,
        pendingEmds: pendingEmdsMapped,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error(`getDashboard failed for title rep ${titleRepId}:`, err)
      throw new InternalServerErrorException('Failed to load dashboard. Please try again.')
    }
  }

  async advanceStep(dealId: string, titleRepId: string): Promise<{ currentStep: string; stepLabel: string }> {
    try {
      if (!Types.ObjectId.isValid(dealId)) {
        throw new NotFoundException('Deal not found.')
      }

      const deal = await this.dealModel.findOne({
        _id: new Types.ObjectId(dealId),
        titleRepId: new Types.ObjectId(titleRepId),
      })

      if (!deal) {
        throw new NotFoundException('Deal not found or not assigned to you.')
      }

      const currentIdx = STEP_ORDER.indexOf(deal.currentStep as DealStep)
      const nextStep = STEP_ORDER[currentIdx + 1]

      if (!nextStep) {
        throw new BadRequestException('Deal is already at the final step.')
      }

      if (!TITLE_REP_STEPS.has(nextStep)) {
        throw new BadRequestException('This step cannot be advanced by the title representative.')
      }

      deal.currentStep = nextStep
      const nowTs = new Date()
      switch (nextStep) {
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

      if (nextStep === DealStep.EMD_DEPOSITED) {
        deal.emdStatus = 'deposited'
      }

      if (nextStep === DealStep.FUNDED_CLOSED) {
        await this.listingModel.findByIdAndUpdate(deal.listingId, { status: ListingStatus.CLOSED }).exec()
      }

      await deal.save()

      this.logger.log(`Deal ${dealId} advanced to ${nextStep} by title rep ${titleRepId}`)

      return {
        currentStep: nextStep,
        stepLabel: STEP_LABELS[nextStep] ?? nextStep,
      }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err
      this.logger.error('advanceStep failed:', err)
      throw new InternalServerErrorException('Failed to advance deal step.')
    }
  }

  async confirmEmd(dealId: string, titleRepId: string): Promise<{ emdStatus: string }> {
    try {
      if (!Types.ObjectId.isValid(dealId)) {
        throw new NotFoundException('Deal not found.')
      }

      const deal = await this.dealModel.findOne({
        _id: new Types.ObjectId(dealId),
        titleRepId: new Types.ObjectId(titleRepId),
      })

      if (!deal) {
        throw new NotFoundException('Deal not found or not assigned to you.')
      }

      if (deal.emdStatus === 'deposited') {
        return { emdStatus: 'deposited' }
      }

      if (deal.emdStatus !== 'pending') {
        throw new BadRequestException('EMD is not awaiting confirmation.')
      }

      deal.emdStatus = 'deposited'
      deal.emdDepositedAt = new Date()
      await deal.save()

      this.logger.log(`EMD confirmed for deal ${dealId} by title rep ${titleRepId}`)

      return { emdStatus: 'deposited' }
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err
      this.logger.error('confirmEmd failed:', err)
      throw new InternalServerErrorException('Failed to confirm EMD receipt.')
    }
  }
}
