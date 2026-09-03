export type ClosedDealSummaryDto = {
  sourceApp: 'app1'
  dealId: string
  listingId: string
  listingAddress: string
  address: string
  city: string
  stateCode: string
  zipCode: string
  purchasePrice: number
  arv: number
  photoUrls: string[]
  closedAt: string
  role: 'wholesaler' | 'realtor'
  /** App2 listing already linked to this App1 deal (do not create a duplicate). */
  linkedListingId?: string | null
  linkedStatus?: string | null
}
