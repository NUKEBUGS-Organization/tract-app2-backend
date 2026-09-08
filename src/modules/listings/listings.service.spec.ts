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

describe('listing ordering', () => {
  it.each(['live', 'mine', 'pending'])('orders %s by creation time and ID before pagination', async (view) => {
    const calls: string[] = []
    const sort = jest.fn((_value: unknown) => { calls.push('sort'); return query })
    const query = {
      select: () => query, sort, populate: () => query, lean: () => query,
      skip: () => { calls.push('skip'); return query }, limit: () => query, exec: async () => [],
    }
    const model = { find: () => query, countDocuments: () => ({ exec: async () => 0 }) }
    const service = new ListingsService(model as never, {} as never, {} as never, {} as never, {} as never)
    if (view === 'live') await service.findLive({ page: 2 })
    else if (view === 'mine') await service.findMyListings('507f1f77bcf86cd799439011')
    else await service.findPendingReview()
    expect(sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 })
    if (view === 'live') expect(calls).toEqual(['sort', 'skip'])
  })
})


it('does not expose private listing amounts or filter by hidden profit publicly', async () => {
  const row = { assignmentFeeHigh: 200000, assignmentFeeLow: 175000, rehabTotal: 30000, purchasePrice: 120000, projectedBuyerProfit: 50000 }
  const query = { select: () => query, sort: () => query, skip: () => query, limit: () => query,
    populate: () => query, lean: () => query, exec: async () => [row] }
  const find = jest.fn((_filter: unknown) => query)
  const model = { find, countDocuments: () => ({ exec: async () => 1 }) }
  const service = new ListingsService(model as never, {} as never, {} as never, {} as never, {} as never)
  const result = await service.findLive({ minProfit: 999999 })
  expect(find.mock.calls[0][0]).not.toHaveProperty('projectedBuyerProfit')
  expect(result.listings).toEqual([{ assignmentFeeHigh: 200000 }])
  expect(row.rehabTotal).toBe(30000)
})

describe('listing lifetime allowance', () => {
  const id = '507f1f77bcf86cd799439011'
  const dto = { dealType: 'fix_flip' as const, propertyAddress: '123 Main', stateCode: 'TX', assignmentFeeHigh: 200000 }

  it('does not consume an attempt when duplicate validation rejects the listing', async () => {
    const usage = { consumeAttempt: jest.fn(), compensateAttempt: jest.fn() }
    const model = { exists: () => ({ exec: async () => true }), create: jest.fn() }
    const service = new (ListingsService as any)(model, {}, {}, {}, {}, usage)

    await expect(service.create(id, { ...dto, app1DealId: 'app1-duplicate' })).rejects.toThrow('already exists')
    expect(usage.consumeAttempt).not.toHaveBeenCalled()
  })

  it('compensates the allowance when listing persistence fails', async () => {
    const persistenceError = new Error('database unavailable')
    const usage = { consumeAttempt: jest.fn().mockResolvedValue(undefined), compensateAttempt: jest.fn().mockResolvedValue(undefined) }
    const model = { create: jest.fn().mockRejectedValue(persistenceError) }
    const service = new (ListingsService as any)(model, {}, {}, {}, {}, usage)

    await expect(service.create(id, dto)).rejects.toBe(persistenceError)
    expect(usage.consumeAttempt).toHaveBeenCalledWith(id, 'listing')
    expect(usage.compensateAttempt).toHaveBeenCalledWith(id, 'listing')
  })
})
