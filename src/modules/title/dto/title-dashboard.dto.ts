export class TitleStatsDto {
  activeDeals!: number
  pendingEmds!: number
  closingThisWeek!: number
  dealsNeedingAction!: number
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
  needsAction!: boolean
  advanceLabel!: string | null
  emdStatus!: string
  emdAmount!: number
  closingDate!: string | null
}

export class PendingEmdDto {
  dealId!: string
  propertyLine!: string
  buyerName!: string
  emdAmount!: number
  emdStatus!: string
  depositedAt!: string | null
}

export class TitleDashboardResponseDto {
  stats!: TitleStatsDto
  activeDeals!: TitleDealRowDto[]
  pendingEmds!: PendingEmdDto[]
}
