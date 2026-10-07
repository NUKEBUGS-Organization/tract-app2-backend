export class TitleStatsDto {
  activeDeals!: number
  closingThisWeek!: number
  dealsNeedingAction!: number
  closedDeals!: number
}

export class TitleDealRowDto {
  id!: string
  listingId!: string
  propertyLine!: string
  city!: string
  stateCode!: string
  buyerName!: string
  wholesalerName!: string
  currentStep!: string
  stepLabel!: string
  stepNumber!: number
  totalSteps!: number
  nextAction!: string
  /** Step the title rep can advance this deal to right now, or null. */
  nextStep!: string | null
  needsAction!: boolean
  advanceLabel!: string | null
  emdAmount!: number
  assignedAt!: string | null
  closingDate!: string | null
}

export class TitleDashboardResponseDto {
  stats!: TitleStatsDto
  activeDeals!: TitleDealRowDto[]
}
