export enum DealStep {
  CONTRACT_SIGNED = 'contract_signed',
  EMD_DEPOSITED = 'emd_deposited',
  INSPECTION_PERIOD = 'inspection_period',
  APPRAISAL_ORDERED = 'appraisal_ordered',
  FINANCING_APPROVED = 'financing_approved',
  TITLE_SEARCH_COMPLETE = 'title_search_complete',
  CLEAR_TO_CLOSE = 'clear_to_close',
  FUNDED_CLOSED = 'funded_closed',
}

// Steps 1-3: Buyer or Wholesaler can advance
// Steps 4-8: Title Rep or Admin only
export const TITLE_REP_STEPS = new Set<DealStep>([
  DealStep.APPRAISAL_ORDERED,
  DealStep.FINANCING_APPROVED,
  DealStep.TITLE_SEARCH_COMPLETE,
  DealStep.CLEAR_TO_CLOSE,
  DealStep.FUNDED_CLOSED,
])

export const STEP_ORDER: DealStep[] = [
  DealStep.CONTRACT_SIGNED,
  DealStep.EMD_DEPOSITED,
  DealStep.INSPECTION_PERIOD,
  DealStep.APPRAISAL_ORDERED,
  DealStep.FINANCING_APPROVED,
  DealStep.TITLE_SEARCH_COMPLETE,
  DealStep.CLEAR_TO_CLOSE,
  DealStep.FUNDED_CLOSED,
]
