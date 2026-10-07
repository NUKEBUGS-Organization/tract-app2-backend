import { DealsService } from './deals.service'
import { DealStep } from '../../common/enums/deal-step.enum'
import { UserRole } from '../../common/enums/user-role.enum'
import { SOCKET_EVENTS } from '../gateway/socket-events.constants'

jest.mock('../gateway/app.gateway', () => ({ AppGateway: class {} }))

const id = '507f1f77bcf86cd799439011'
const buyer = '507f1f77bcf86cd799439012'
const admin = '507f1f77bcf86cd799439013'
const seller = '507f1f77bcf86cd799439014'
function setup(step = DealStep.TITLE_SEARCH_COMPLETE, titleHandling = 'tract') {
  const deal = { _id: id, primaryBuyerId: buyer, wholesalerId: seller, listingId: id,
    currentStep: step, titleHandling, disputeFrozen: false }
  const query = { populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(deal),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(deal).then(resolve) }
  const model = { findById: jest.fn(() => query), find: jest.fn(() => query),
    findOneAndUpdate: jest.fn(async (_filter, update) => ({ ...deal, ...update.$set })) }
  const users = { find: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => [{ _id: admin }] }) }) })) }
  const gateway = { emitToDeal: jest.fn(), emitToUser: jest.fn() }
  const notifications = { create: jest.fn().mockResolvedValue({}) }
  const listing = { findByIdAndUpdate: () => ({ exec: async () => ({}) }),
    findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({}) }) }) }) }
  const service = new DealsService(model as never, {} as never, listing as never, users as never,
    {} as never, {} as never, gateway as never, {} as never, notifications as never,
    { markDealClosed: jest.fn() } as never, {} as never, {} as never)
  return { service, model, query, gateway, notifications, deal }
}

describe('title handling permissions and admin visibility', () => {
  it.each([UserRole.BUYER, UserRole.WHOLESALER, UserRole.TITLE_REP])('blocks %s from advancing admin-managed title', async (role) => {
    const { service, model } = setup()
    await expect(service.advanceStep(id, buyer, role, { step: DealStep.CLEAR_TO_CLOSE })).rejects.toThrow('Only an admin')
    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('also blocks the buyer from closing an admin-managed deal', async () => {
    const { service } = setup(DealStep.CLEAR_TO_CLOSE)
    await expect(service.advanceStep(id, buyer, UserRole.BUYER, { step: DealStep.FUNDED_CLOSED })).rejects.toThrow('Only an admin')
  })
  it.each([DealStep.TITLE_SEARCH_COMPLETE, DealStep.CLEAR_TO_CLOSE])('allows admin advancement from %s', async (step) => {
    const { service } = setup(step)
    const next = step === DealStep.TITLE_SEARCH_COMPLETE ? DealStep.CLEAR_TO_CLOSE : DealStep.FUNDED_CLOSED
    await expect(service.advanceStep(id, admin, UserRole.ADMIN, { step: next })).resolves.toMatchObject({ currentStep: next })
  })
  it('preserves buyer advancement with own title rep', async () => {
    const { service } = setup(DealStep.TITLE_SEARCH_COMPLETE, 'own_rep')
    await expect(service.advanceStep(id, buyer, UserRole.BUYER, { step: DealStep.CLEAR_TO_CLOSE })).resolves.toMatchObject({ currentStep: DealStep.CLEAR_TO_CLOSE })
  })
  it.each(['tract', 'own_rep'])('forwards title entry to admins for %s', async (handling) => {
    const { service, notifications, gateway, model } = setup(DealStep.FINANCING_APPROVED, handling)
    await service.advanceStep(id, buyer, UserRole.BUYER, { step: DealStep.TITLE_SEARCH_COMPLETE })
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: admin, dealId: id, title: 'Deal entered title search' }))
    expect(gateway.emitToUser).toHaveBeenCalledWith(admin, SOCKET_EVENTS.DEAL_STEP_ADVANCED, { dealId: id, currentStep: DealStep.TITLE_SEARCH_COMPLETE })
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ titleHandling: handling }), expect.anything(), expect.anything())
  })
  it('prevents switching to own rep to bypass admin control after title begins', async () => {
    const { service, model } = setup()
    await expect(service.chooseTitleHandling(id, buyer, UserRole.BUYER, { titleHandling: 'own_rep' })).rejects.toThrow('only be changed by an admin')
    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })
  it('makes title detail and signed contract available to admin but rejects outsiders', async () => {
    const { service, query } = setup()
    await expect(service.findOne(id, admin, UserRole.ADMIN)).resolves.toMatchObject({ titleHandling: 'tract' })
    expect(query.populate).toHaveBeenCalledWith('contractId', expect.stringContaining('signedPdfUrl'))
    expect(query.populate).toHaveBeenCalledWith('listingId', expect.stringContaining('photoUrls'))
    await expect(service.findOne(id, admin, UserRole.BUYER)).rejects.toThrow('not a party')
  })
  it('lists all deals for the admin dashboard', async () => {
    const { service, model } = setup()
    await service.findMyDeals(admin, UserRole.ADMIN)
    expect(model.find).toHaveBeenCalledWith({})
  })
  it('rejects an advancement if title handling changed concurrently', async () => {
    const { service, model } = setup(DealStep.TITLE_SEARCH_COMPLETE, 'own_rep')
    model.findOneAndUpdate.mockResolvedValueOnce(null as never)
    await expect(service.advanceStep(id, buyer, UserRole.BUYER, { step: DealStep.CLEAR_TO_CLOSE })).rejects.toThrow('just advanced')
  })
})

describe('admin title representative request queue', () => {
  function queueSetup(deals: Array<Record<string, unknown>>) {
    const query = { populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(deals) }
    const model = { find: jest.fn(() => query) }
    const service = new DealsService(model as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, { emitToDeal: jest.fn(), emitToUser: jest.fn() } as never,
      {} as never, { create: jest.fn() } as never, {} as never, {} as never, {} as never)
    return { service, model, query }
  }

  it('returns only deals the buyer routed to TRACT', async () => {
    const { service, model } = queueSetup([])
    await service.findTitleRepRequests(UserRole.ADMIN)
    expect(model.find).toHaveBeenCalledWith({ titleHandling: 'tract' })
  })

  it.each([UserRole.BUYER, UserRole.WHOLESALER, UserRole.REALTOR, UserRole.TITLE_REP])(
    'refuses the queue to %s', async (role) => {
      const { service, model } = queueSetup([])
      await expect(service.findTitleRepRequests(role)).rejects.toThrow('Only an admin')
      expect(model.find).not.toHaveBeenCalled()
    })

  it('flags only the steps an admin must advance', async () => {
    const { service } = queueSetup([
      { _id: '1', currentStep: DealStep.EMD_DEPOSITED, disputeFrozen: false, buyerFailed: false },
      { _id: '2', currentStep: DealStep.TITLE_SEARCH_COMPLETE, disputeFrozen: false, buyerFailed: false },
      { _id: '3', currentStep: DealStep.FUNDED_CLOSED, disputeFrozen: false, buyerFailed: false },
      { _id: '4', currentStep: DealStep.CLEAR_TO_CLOSE, disputeFrozen: true, buyerFailed: false },
      { _id: '5', currentStep: DealStep.CLEAR_TO_CLOSE, disputeFrozen: false, buyerFailed: true },
    ])
    const rows = await service.findTitleRepRequests(UserRole.ADMIN) as Array<Record<string, unknown>>
    expect(rows.map((row) => row.awaitingAdmin)).toEqual([false, true, false, false, false])
    // The buyer still drives the early steps, so the next step is exposed either way.
    expect(rows[0].nextStep).toBe(DealStep.INSPECTION_PERIOD)
    expect(rows[1].nextStep).toBe(DealStep.CLEAR_TO_CLOSE)
    // A closed deal has nothing left to advance to.
    expect(rows[2].nextStep).toBeNull()
  })
})

describe('title representative selection', () => {
  it('alerts admins as soon as the buyer picks TRACT', async () => {
    const { service, notifications, gateway } = setup(DealStep.EMD_DEPOSITED, 'own_rep')
    await service.chooseTitleHandling(id, buyer, UserRole.BUYER, { titleHandling: 'tract' })
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: admin, dealId: id, title: 'Title representative request' }),
    )
    expect(gateway.emitToUser).toHaveBeenCalledWith(admin, SOCKET_EVENTS.DEAL_STEP_ADVANCED, expect.objectContaining({ dealId: id }))
  })

  it('stays quiet when the buyer keeps their own representative', async () => {
    const { service, notifications } = setup(DealStep.EMD_DEPOSITED, 'tract')
    await service.chooseTitleHandling(id, buyer, UserRole.BUYER, { titleHandling: 'own_rep' })
    expect(notifications.create).not.toHaveBeenCalled()
  })
})

describe('TRACT title representative assignment', () => {
  const rep = '507f1f77bcf86cd799439015'
  const otherRep = '507f1f77bcf86cd799439016'

  function assignSetup(dealOverrides: Record<string, unknown> = {}, repDoc: Record<string, unknown> | null = { _id: rep, fullName: 'Tia Title', email: 'tia@title.test', isBanned: false }) {
    const deal = { _id: id, primaryBuyerId: buyer, wholesalerId: seller, listingId: id,
      currentStep: DealStep.TITLE_SEARCH_COMPLETE, titleHandling: 'tract', titleRepId: null,
      emdAmount: 5000, disputeFrozen: false, ...dealOverrides }
    const chain = (value: unknown) => ({ select: () => ({ lean: () => ({ exec: async () => value }) }) })
    const model = { findById: jest.fn(async () => deal),
      findOneAndUpdate: jest.fn(async (_filter, update) => ({ ...deal, ...update.$set })) }
    const users = {
      findOne: jest.fn(() => chain(repDoc)),
      findById: jest.fn((userId: string) => chain({ fullName: userId === buyer ? 'Bea Buyer' : 'Will Wholesaler', email: `${userId}@x.test`, phone: '+15555550100' })),
    }
    const listing = { findById: () => chain({ propertyAddress: '1 Main St', city: 'Austin', stateCode: 'TX', zipCode: '78701', dealType: 'fix_flip', arv: 300000, purchasePrice: 150000, photoUrls: ['a', 'b'] }) }
    const resend = { sendMail: jest.fn().mockResolvedValue(true) }
    const gateway = { emitToDeal: jest.fn(), emitToUser: jest.fn() }
    const notifications = { create: jest.fn().mockResolvedValue({}) }
    const config = { get: jest.fn(() => 'https://buyer.example.test') }
    const service = new DealsService(model as never, {} as never, listing as never, users as never,
      {} as never, {} as never, gateway as never, resend as never, notifications as never,
      {} as never, config as never, {} as never)
    return { service, model, users, resend, notifications, gateway }
  }

  it('assigns the rep and emails them the full deal', async () => {
    const { service, model, resend, notifications } = assignSetup()
    await expect(service.assignTitleRep(id, rep)).resolves.toMatchObject({ titleRepId: expect.anything() })
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ titleHandling: 'tract', titleRepId: null }),
      { $set: expect.objectContaining({ titleRepAssignedAt: expect.any(Date) }) },
      expect.anything(),
    )
    const [to, subject, html] = resend.sendMail.mock.calls[0]
    expect(to).toBe('tia@title.test')
    expect(subject).toContain('1 Main St')
    for (const detail of ['$150,000', '$300,000', '$5,000', 'Bea Buyer', 'Will Wholesaler', `/deals/${id}`]) {
      expect(html).toContain(detail)
    }
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: rep, title: 'New deal assigned to you' }))
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: buyer, title: 'Title representative assigned' }))
  })

  it('tells the previous rep when a deal is reassigned', async () => {
    const { service, notifications } = assignSetup({ titleRepId: otherRep })
    await service.assignTitleRep(id, rep)
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ userId: otherRep, title: 'Deal reassigned' }))
  })

  it('keeps the assignment when the email fails', async () => {
    const { service, resend, model } = assignSetup()
    resend.sendMail.mockRejectedValueOnce(new Error('smtp down'))
    await expect(service.assignTitleRep(id, rep)).resolves.toBeDefined()
    expect(model.findOneAndUpdate).toHaveBeenCalled()
  })

  it('only assigns on deals the buyer routed to TRACT', async () => {
    const { service, model } = assignSetup({ titleHandling: 'own_rep' })
    await expect(service.assignTitleRep(id, rep)).rejects.toThrow('after the buyer selects TRACT')
    expect(model.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('refuses users who are not title reps', async () => {
    const { service } = assignSetup({}, null)
    await expect(service.assignTitleRep(id, rep)).rejects.toThrow('not a title representative')
  })

  it('refuses closed deals and suspended reps', async () => {
    await expect(assignSetup({ currentStep: DealStep.FUNDED_CLOSED }).service.assignTitleRep(id, rep)).rejects.toThrow('already closed')
    await expect(assignSetup({}, { _id: rep, fullName: 'Tia', email: 't@x.test', isBanned: true }).service.assignTitleRep(id, rep)).rejects.toThrow('suspended')
  })

  it('lets the assigned rep advance title and closing steps', async () => {
    const { service, deal } = setup()
    Object.assign(deal, { titleRepId: { toString: () => rep } })
    await expect(service.advanceStep(id, rep, UserRole.TITLE_REP, { step: DealStep.CLEAR_TO_CLOSE })).resolves.toMatchObject({ currentStep: DealStep.CLEAR_TO_CLOSE })
  })

  it('blocks a rep who is not assigned to the deal', async () => {
    const { service, deal } = setup()
    Object.assign(deal, { titleRepId: { toString: () => otherRep } })
    await expect(service.advanceStep(id, rep, UserRole.TITLE_REP, { step: DealStep.CLEAR_TO_CLOSE })).rejects.toThrow('Only an admin or the assigned title representative')
  })

  it('leaves pre-title steps with the buyer even for the assigned rep', async () => {
    const { service, deal } = setup(DealStep.FINANCING_APPROVED)
    Object.assign(deal, { titleRepId: { toString: () => rep } })
    await expect(service.advanceStep(id, rep, UserRole.TITLE_REP, { step: DealStep.TITLE_SEARCH_COMPLETE })).rejects.toThrow('Only the primary buyer')
  })

  it('revokes the rep when an admin switches the deal to the buyer’s own rep', async () => {
    const { service, model } = setup()
    await service.chooseTitleHandling(id, admin, UserRole.ADMIN, { titleHandling: 'own_rep' })
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      { $set: { titleHandling: 'own_rep', titleRepId: null, titleRepAssignedAt: null } },
      expect.anything(),
    )
  })

  it('flags open TRACT deals that still need a rep in the admin queue', async () => {
    const query = { populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([
        { _id: '1', currentStep: DealStep.TITLE_SEARCH_COMPLETE, titleRepId: null },
        { _id: '2', currentStep: DealStep.TITLE_SEARCH_COMPLETE, titleRepId: rep },
        { _id: '3', currentStep: DealStep.FUNDED_CLOSED, titleRepId: null },
        { _id: '4', currentStep: DealStep.CLEAR_TO_CLOSE, titleRepId: null, buyerFailed: true },
      ]) }
    const service = new DealsService({ find: () => query } as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const rows = await service.findTitleRepRequests(UserRole.ADMIN) as Array<Record<string, unknown>>
    expect(rows.map((r) => r.needsAssignment)).toEqual([true, false, false, false])
    expect(query.populate).toHaveBeenCalledWith('titleRepId', 'fullName email')
  })
})
