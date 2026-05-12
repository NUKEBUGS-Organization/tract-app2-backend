export class PenaltyDetailDto {
  id!: string
  userId!: string
  userName!: string
  userEmail!: string
  userRole!: string
  violationType!: string
  violationLabel!: string
  scoreDeduction!: number
  automatedPenalties!: string[]
  banApplied!: boolean
  banExpiresAt!: string | null
  resolved!: boolean
  resolvedAt!: string | null
  resolutionNotes!: string
  dealId!: string | null
  listingId!: string | null
  createdAt!: string
}
