import { BidsService } from './bids.service'
import { ListingStatus } from '../../common/enums/listing-status.enum'

describe('bid lifetime allowance', () => {
  const buyerId = '507f1f77bcf86cd799439011'
  const listingId = '507f1f77bcf86cd799439012'
  const dto = { listingId, assignmentPrice: 200000 }

  it('does not consume an attempt for a listing that is not accepting bids', async () => {
    const usage = { consumeAttempt: jest.fn(), compensateAttempt: jest.fn() }
    const listingModel = { findById: () => ({ select: () => ({ lean: async () => ({ status: ListingStatus.DRAFT, bidsOpen: false, bidCount: 0 }) }) }) }
    const service = new (BidsService as any)({}, listingModel, {}, {}, usage)

    await expect(service.placeBid(buyerId, dto, 'buyer')).rejects.toThrow('not currently accepting bids')
    expect(usage.consumeAttempt).not.toHaveBeenCalled()
  })

  it('compensates the allowance when bid persistence fails', async () => {
    const usage = { consumeAttempt: jest.fn().mockResolvedValue(undefined), compensateAttempt: jest.fn().mockResolvedValue(undefined) }
    const listing = { status: ListingStatus.LIVE, bidsOpen: true, bidCount: 0, assignmentFeeLow: 0 }
    const listingModel = {
      findById: () => ({ select: () => ({ lean: async () => listing }) }),
      findOneAndUpdate: () => ({ bidCount: 1 }),
      updateOne: jest.fn(() => ({ exec: async () => undefined })),
    }
    const persistenceError = new Error('database unavailable')
    const bidModel = { findOne: async () => null, create: jest.fn().mockRejectedValue(persistenceError) }
    const service = new (BidsService as any)(bidModel, listingModel, {}, {}, usage)

    await expect(service.placeBid(buyerId, dto, 'buyer')).rejects.toBe(persistenceError)
    expect(usage.consumeAttempt).toHaveBeenCalledWith(buyerId, 'bid')
    expect(usage.compensateAttempt).toHaveBeenCalledWith(buyerId, 'bid')
  })
})
