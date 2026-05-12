export class DashboardStatDto {
  activeDeals!: number
  myListings!: number
  totalBidsReceived!: number
  reliabilityScore!: number
  reliabilityTier!: string
  killSwitchAlerts!: number
}

export class KillSwitchAlertDto {
  dealId!: string
  listingId!: string
  headline!: string
  detailLine!: string
  timerLabel!: string
  hoursLeft!: number
}

export class PipelineDealDto {
  id!: string
  listingId!: string
  propertyLine!: string
  portfolioRef!: string
  imageUrl!: string
  status!: string
  currentStep!: string
  stepLabel!: string
  timerLabel!: string
  timerTone!: 'green' | 'red'
  timerPulse!: boolean
  primaryAction!: 'view' | 'upload'
  marketingProofUploaded!: boolean
  marketingProofDeadline!: string | null
}

export class ActiveListingDto {
  id!: string
  address!: string
  city!: string
  stateCode!: string
  imageUrl!: string
  status!: string
  bidCount!: number
  arv!: number
  assignmentFeeHigh!: number
  projectedBuyerProfit!: number
  publishedAt!: string | null
  bidsOpen!: boolean
}

export class WholesalerDashboardResponseDto {
  stats!: DashboardStatDto
  killSwitch!: KillSwitchAlertDto | null
  pipeline!: PipelineDealDto[]
  listings!: ActiveListingDto[]
}
