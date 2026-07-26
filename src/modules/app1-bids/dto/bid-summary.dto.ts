export type BidSummaryDto = {
  sourceApp: 'app1'
  bidId: string
  listingId: string
  listingAddress: string
  bidPrice: number
  status: string
  submittedAt: string
  role: 'wholesaler' | 'realtor'
}
