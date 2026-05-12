export class BuyerStatsDto {
  activeBids!: number
  dealsInProgress!: number
  dealsClosed!: number
  reliabilityScore!: number
  reliabilityTier!: string
  isVettedBuyer!: boolean
}

export class ActiveBidDto {
  id!: string
  listingId!: string
  propertyLine!: string
  city!: string
  stateCode!: string
  imageUrl!: string
  assignmentPrice!: number
  status!: string
  statusLabel!: string
  submittedAt!: string
  action!: 'view' | 'deal'
  dealId?: string | null
}

export class ActiveDealDto {
  id!: string
  listingId!: string
  propertyLine!: string
  city!: string
  stateCode!: string
  imageUrl!: string
  currentStep!: string
  stepLabel!: string
  stepNumber!: number
  totalSteps!: number
  emdStatus!: string
  emdAmount!: number
  wholesalerName!: string
}

export class RecommendedListingDto {
  id!: string
  propertyAddress!: string
  city!: string
  stateCode!: string
  imageUrl!: string
  dealType!: string
  arv!: number
  rehabTotal!: number
  assignmentFeeHigh!: number
  projectedBuyerProfit!: number
  bidCount!: number
  bidsOpen!: boolean
  publishedAt!: string | null
}

export class BuyerDashboardResponseDto {
  stats!: BuyerStatsDto
  activeBids!: ActiveBidDto[]
  activeDeals!: ActiveDealDto[]
  recommendedListings!: RecommendedListingDto[]
}
