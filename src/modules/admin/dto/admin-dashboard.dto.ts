export class AdminStatsDto {
  pendingReview!: number
  activeDeals!: number
  flaggedPenalties!: number
  totalUsers!: number
  platformRevenue!: number
  liveListings!: number
}

export class PendingListingDto {
  id!: string
  propertyAddress!: string
  city!: string
  stateCode!: string
  wholesalerName!: string
  submittedAt!: string
  outlierFlagged!: boolean
  flagLabel!: string
  arv!: number
  rehabTotal!: number
}

export class RecentPenaltyDto {
  id!: string
  userId!: string
  userName!: string
  violationType!: string
  violationLabel!: string
  scoreDeduction!: number
  createdAt!: string
  resolved!: boolean
  banApplied!: boolean
}

export class AdminDashboardResponseDto {
  stats!: AdminStatsDto
  pendingListings!: PendingListingDto[]
  recentPenalties!: RecentPenaltyDto[]
}
