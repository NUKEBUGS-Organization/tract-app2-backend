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

// Steps 1–3 targets: wholesaler / realtor (listing owner) advances
// Steps 4–8: primary buyer (or admin) advances
export const BUYER_ADVANCE_STEPS = new Set<DealStep>([
  DealStep.APPRAISAL_ORDERED,
  DealStep.FINANCING_APPROVED,
  DealStep.TITLE_SEARCH_COMPLETE,
  DealStep.CLEAR_TO_CLOSE,
  DealStep.FUNDED_CLOSED,
])

/** @deprecated use BUYER_ADVANCE_STEPS — title rep path retired for MVP */
export const TITLE_REP_STEPS = BUYER_ADVANCE_STEPS

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
