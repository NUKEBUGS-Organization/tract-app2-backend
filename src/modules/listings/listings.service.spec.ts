import { ListingsService } from './listings.service'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { AdminService } from '../admin/admin.service'

describe('listing profit publication gate', () => {
  const id = '507f1f77bcf86cd799439011'
  function setup(profit: number, app1DealId?: string) {
    const listing = {
      _id: id, wholesalerId: id, status: ListingStatus.DRAFT,
      propertyAddress: '123 Main St', stateCode: 'TX', zipCode: '75001',
      arv: 300000, purchasePrice: 180000, rehabTotal: 20000,
      estimatedHoldingCosts: 1000, projectedBuyerProfit: 999999,
      outlierFlagged: false,
      assignmentFeeLow: 201000 + profit, assignmentFeeHigh: 220000,
      app1DealId, marketingProofSatisfiedByListing: true,
      save: jest.fn().mockResolvedValue(undefined),
    }
    const model = { findById: () => ({ select: async () => listing }) }
    const service = new ListingsService(model as never, {} as never, {} as never, {} as never, {} as never)
    return { listing, service }
  }

  it.each([undefined, 'app1-deal'])('rejects loss for source %s, recalculating financials', async (source) => {
    const { service, listing } = setup(-1250.25, source)
    await expect(service.publish(id, id)).rejects.toThrow(
      'The current pricing will cause a $1,250.25 loss to you. Please adjust the pricing to move forward.',
    )
    expect(listing.save).not.toHaveBeenCalled()
    expect(listing.status).toBe(ListingStatus.DRAFT)
  })

  it.each([0, 2500])('allows nonnegative profit %s', async (profit) => {
    const { service, listing } = setup(profit)
    await expect(service.publish(id, id)).resolves.toBe(listing)
    expect(listing.status).toBe(ListingStatus.PENDING_REVIEW)
  })

  it('rejects a market price below purchase even with a higher reserve', async () => {
    const { service, listing } = setup(5000)
    listing.assignmentFeeHigh = 200000
    await expect(service.publish(id, id)).rejects.toThrow('a $1,000 loss to you')
  })

  it('does not mistake the buyer rehab forecast for seller earnings', async () => {
    const { service, listing } = setup(5000)
    listing.arv = 100000
    await expect(service.publish(id, id)).resolves.toBe(listing)
  })

  it('requires an explicit minimum price even when costs are zero', async () => {
    const { service, listing } = setup(0)
    Object.assign(listing, { assignmentFeeLow: 0, purchasePrice: 0, rehabTotal: 0, estimatedHoldingCosts: 0 })
    await expect(service.publish(id, id)).rejects.toThrow('assignmentFeeLow')
  })

  it('rejects a pending-review edit that introduces a loss', async () => {
    const { service, listing } = setup(5000)
    listing.status = ListingStatus.PENDING_REVIEW
    await expect(service.update(id, id, { rehabTotal: 30000 })).rejects.toThrow('a $5,000 loss to you')
    expect(listing.save).not.toHaveBeenCalled()
  })

  it('allows saving a negative draft for later correction', async () => {
    const { service, listing } = setup(5000)
    await expect(service.update(id, id, { rehabTotal: 30000 })).resolves.toBe(listing)
  })

  it('rejects admin approval of an already-negative pending listing', async () => {
    const { listing } = setup(-1000)
    listing.status = ListingStatus.PENDING_REVIEW
    const mutate = jest.fn(() => ({ exec: async () => ({ ...listing, status: ListingStatus.LIVE }) }))
    const model = {
      findById: () => ({ select: () => ({ lean: () => ({ exec: async () => listing }) }) }),
      findOneAndUpdate: mutate,
    }
    const service = new AdminService(model as never, {} as never, {} as never, {} as never, {} as never)
    await expect(service.reviewListing(id, 'approve', id)).rejects.toThrow('a $1,000 loss to you')
    expect(mutate).not.toHaveBeenCalled()
  })

  it.each([[14999, true], [15000, false], [15001, false]])(
    'publishes rehab %s with the strict five-percent flag %s', async (rehab, flagged) => {
      const { service, listing } = setup(5000)
      listing.rehabTotal = rehab as number
      listing.outlierFlagged = !flagged
      await service.publish(id, id)
      expect(listing.outlierFlagged).toBe(flagged)
      expect(listing.status).toBe(ListingStatus.PENDING_REVIEW)
    },
  )

  it('recalculates the flag when a pending listing crosses five percent', async () => {
    const { service, listing } = setup(5000)
    listing.status = ListingStatus.PENDING_REVIEW
    await service.update(id, id, { rehabTotal: 14999 })
    expect(listing.outlierFlagged).toBe(true)
    await service.update(id, id, { rehabTotal: 15000 })
    expect(listing.outlierFlagged).toBe(false)
  })

  it('clears the low-rehab flag if a draft ARV is cleared', async () => {
    const { service, listing } = setup(5000)
    listing.outlierFlagged = true
    await service.update(id, id, { arv: 0 })
    expect(listing.outlierFlagged).toBe(false)
  })

  it('maps the published low-rehab flag into the admin compliance queue', async () => {
    const { service, listing } = setup(5000)
    listing.rehabTotal = 14999
    await service.publish(id, id)
    const query = { populate: () => query, sort: () => query, skip: () => query, limit: () => query, lean: async () => [listing] }
    const model = { find: () => query, countDocuments: async () => 1 }
    const admin = new AdminService(model as never, {} as never, {} as never, {} as never, {} as never)
    const queue = await admin.getPendingListings()
    expect(queue.listings[0]).toMatchObject({ outlierFlagged: true, flagLabel: 'Low Rehab', arv: 300000, rehabTotal: 14999 })
  })

  it('allows admin to approve a low-rehab listing and clears its reviewed flag', async () => {
    const { listing } = setup(5000)
    Object.assign(listing, { status: ListingStatus.PENDING_REVIEW, rehabTotal: 14999, outlierFlagged: true })
    const model = {
      findById: () => ({ select: () => ({ lean: () => ({ exec: async () => listing }) }) }),
      findOneAndUpdate: (_filter: unknown, update: { $set: Record<string, unknown> }) => ({
        exec: async () => Object.assign(listing, update.$set),
      }),
    }
    const admin = new AdminService(model as never, {} as never, {} as never, {} as never, {} as never)
    await expect(admin.reviewListing(id, 'approve', id)).resolves.toMatchObject({ status: ListingStatus.LIVE })
    expect(listing.outlierFlagged).toBe(false)
  })
  it('also rejects approval through the listings admin-review endpoint', async () => {
    const { listing } = setup(-1000)
    listing.status = ListingStatus.PENDING_REVIEW
    const model = { findById: () => ({ select: () => ({ exec: async () => listing }) }), findOneAndUpdate: jest.fn() }
    const service = new ListingsService(model as never, {} as never, {} as never, {} as never, {} as never)
    await expect(service.adminReview(id, 'approve')).rejects.toThrow('a $1,000 loss to you')
    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })
})
