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
}
