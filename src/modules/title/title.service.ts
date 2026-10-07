import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import type { TitleDashboardResponseDto } from './dto/title-dashboard.dto'
import { DealStep, STEP_ORDER } from '../../common/enums/deal-step.enum'

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

const ADVANCE_LABELS: Partial<Record<DealStep, string>> = {
  [DealStep.CLEAR_TO_CLOSE]: 'Issue Clear to Close',
  [DealStep.FUNDED_CLOSED]: 'Mark Funded & Closed',
}

/** From title search onward the assigned rep (or an admin) drives a TRACT-handled deal. */
const TITLE_GATE_IDX = STEP_ORDER.indexOf(DealStep.TITLE_SEARCH_COMPLETE)

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

  constructor(@InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>) {}

  async getDashboard(titleRepId: string): Promise<TitleDashboardResponseDto> {
    try {
      if (!Types.ObjectId.isValid(titleRepId)) {
        throw new NotFoundException('Title representative not found.')
      }

      const deals = await this.dealModel
        .find({ titleRepId: new Types.ObjectId(titleRepId) })
        .populate('listingId', 'propertyAddress city stateCode photoUrls')
        .populate('primaryBuyerId', 'fullName')
        .populate('wholesalerId', 'fullName')
        .sort({ titleRepAssignedAt: -1, createdAt: -1 })
        .lean()

      const open = deals.filter((d) => d.currentStep !== DealStep.FUNDED_CLOSED)

      const activeDeals = open.map((deal) => {
        const listing = deal.listingId as unknown as
          | { _id?: Types.ObjectId; propertyAddress?: string; city?: string; stateCode?: string }
          | undefined
        const buyer = deal.primaryBuyerId as unknown as { fullName?: string } | undefined
        const wholesaler = deal.wholesalerId as unknown as { fullName?: string } | undefined
        const step = deal.currentStep as DealStep
        const rawIdx = STEP_ORDER.indexOf(step)
        const stepIdx = rawIdx >= 0 ? rawIdx : 0
        const nextStep = STEP_ORDER[stepIdx + 1] ?? null
        const canAdvance = Boolean(
          nextStep &&
            deal.titleHandling === 'tract' &&
            stepIdx >= TITLE_GATE_IDX &&
            !deal.disputeFrozen &&
            !deal.buyerFailed,
        )
        const ctc = deal.clearToCloseAt

        let nextAction = 'Waiting on deal parties'
        if (deal.disputeFrozen) nextAction = 'Frozen — dispute in progress'
        else if (canAdvance && nextStep) nextAction = ADVANCE_LABELS[nextStep] ?? 'Advance deal'
        else if (stepIdx < TITLE_GATE_IDX) nextAction = 'Waiting for buyer to reach title search'

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
          nextAction,
          nextStep: canAdvance ? nextStep : null,
          needsAction: canAdvance,
          advanceLabel: canAdvance && nextStep ? (ADVANCE_LABELS[nextStep] ?? 'Advance') : null,
          emdAmount: deal.emdAmount ?? 0,
          assignedAt: deal.titleRepAssignedAt instanceof Date ? deal.titleRepAssignedAt.toISOString() : null,
          closingDate: ctc instanceof Date ? ctc.toISOString() : null,
        }
      })

      return {
        stats: {
          activeDeals: open.length,
          closingThisWeek: open.filter((d) => isClosingThisWeek(d as Deal)).length,
          dealsNeedingAction: activeDeals.filter((d) => d.needsAction).length,
          closedDeals: deals.length - open.length,
        },
        activeDeals,
      }
    } catch (err) {
      if (err instanceof NotFoundException) throw err
      this.logger.error(`getDashboard failed for title rep ${titleRepId}:`, err)
      throw new InternalServerErrorException('Failed to load dashboard. Please try again.')
    }
  }
}
