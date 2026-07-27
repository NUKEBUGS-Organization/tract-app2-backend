export type ClosedDealSummaryDto = {
  sourceApp: 'app1'
  dealId: string
  listingId: string
  listingAddress: string
  address: string
  stateCode: string
  zipCode: string
  purchasePrice: number
  closedAt: string
  role: 'wholesaler' | 'realtor'
}
