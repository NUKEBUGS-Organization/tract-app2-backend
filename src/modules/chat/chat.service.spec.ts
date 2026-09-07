import { Types } from 'mongoose'
import { ChatService } from './chat.service'
import { DealStep } from '../../common/enums/deal-step.enum'

jest.mock('../gateway/app.gateway', () => ({ AppGateway: class {} }))

describe('chat blocked-message delivery', () => {
  const buyer = new Types.ObjectId().toString()
  const seller = new Types.ObjectId().toString()
  const dealId = new Types.ObjectId().toString()
  const createdId = new Types.ObjectId()
  const makeService = () => {
    const messages = {
      create: jest.fn(async (value) => ({ ...value, _id: createdId })),
      countDocuments: jest.fn().mockResolvedValue(1),
    }
    const deals = { findById: jest.fn().mockResolvedValue({ primaryBuyerId: buyer, wholesalerId: seller, currentStep: DealStep.CONTRACT_SIGNED }) }
    const gateway = { emitToDeal: jest.fn() }
    const service = new ChatService(messages as never, deals as never, {} as never, gateway as never)
    return { service, messages, gateway }
  }

  it('saves a flag but never broadcasts blocked content', async () => {
    const { service, messages, gateway } = makeService()
    const result = await service.sendMessage(buyer, { dealId, content: 'Contact 5*5*5*1*2*3*4*5*6*7' })
    expect(messages.create).toHaveBeenCalledWith(expect.objectContaining({ isFlagged: true, isBlocked: true, content: '[message blocked: contact information]' }))
    expect(result.isBlocked).toBe(true)
    expect(gateway.emitToDeal).not.toHaveBeenCalled()
  })

  it('broadcasts ordinary property discussion unchanged', async () => {
    const { service, gateway } = makeService()
    await service.sendMessage(buyer, { dealId, content: 'The rehab estimate is $45,500.' })
    expect(gateway.emitToDeal).toHaveBeenCalledWith(dealId, expect.any(String), expect.objectContaining({ content: 'The rehab estimate is $45,500.' }))
  })

  it('excludes blocked records from participant history but includes them for admins', async () => {
    const chain = { populate: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) }
    const messages = { find: jest.fn().mockReturnValue(chain), countDocuments: jest.fn().mockResolvedValue(0), updateMany: jest.fn() }
    const deals = { findById: jest.fn().mockResolvedValue({ primaryBuyerId: buyer, wholesalerId: seller }) }
    const service = new ChatService(messages as never, deals as never, {} as never, {} as never)
    await service.getMessages(dealId, buyer, 'buyer', {})
    expect(messages.find).toHaveBeenLastCalledWith(expect.objectContaining({ isBlocked: false }))
    await service.getMessages(dealId, new Types.ObjectId().toString(), 'admin', {})
    expect(messages.find).toHaveBeenLastCalledWith({ dealId: new Types.ObjectId(dealId) })
    expect(messages.updateMany).toHaveBeenCalledTimes(1)
  })
})
