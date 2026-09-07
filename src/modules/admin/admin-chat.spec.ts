import { Reflector } from '@nestjs/core'
import { ExecutionContext } from '@nestjs/common'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { RolesGuard } from '../../common/guards/roles.guard'
import { UserRole } from '../../common/enums/user-role.enum'

describe('admin conversation review', () => {
  it.each([UserRole.BUYER, UserRole.WHOLESALER, UserRole.REALTOR, undefined, UserRole.ADMIN])('enforces admin role for %s', (role) => {
    for (const handler of [AdminController.prototype.getChatConversations, AdminController.prototype.getChatHistory]) {
      const context = { getType: () => 'http', getHandler: () => handler, getClass: () => AdminController, switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) } as unknown as ExecutionContext
      const check = () => new RolesGuard(new Reflector()).canActivate(context)
      if (role === UserRole.ADMIN) expect(check()).toBe(true)
      else expect(check).toThrow('Access denied')
    }
  })
  it('includes unflagged conversations by default, bounds pages and escapes search', async () => {
    const aggregate = jest.fn().mockResolvedValue([{ conversations: [{ dealId: 'deal', flaggedCount: 0 }], count: [{ total: 1 }] }])
    const service = new AdminService({} as never, {} as never, {} as never, {} as never, { aggregate } as never)
    const result = await service.getChatConversations(-1, 500)
    expect(result.conversations[0].flaggedCount).toBe(0)
    const pipeline = aggregate.mock.calls[0][0]
    expect(pipeline).not.toContainEqual({ $match: { flaggedCount: { $gt: 0 } } })
    expect(pipeline.at(-1).$facet.conversations).toEqual([{ $skip: 0 }, { $limit: 100 }])
    await service.getChatConversations(1, 20, 'Ann.*', true)
    const filtered = aggregate.mock.calls[1][0]
    expect(filtered).toContainEqual({ $match: { flaggedCount: { $gt: 0 } } })
    expect(filtered.find((stage: any) => stage.$match?.$or).$match.$or[0].dealId.$regex).toBe('Ann\\.\\*')
  })
  it('loads blocked attempts in history and rejects invalid IDs', async () => {
    const chain: any = { populate: jest.fn(), sort: jest.fn(), skip: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue([{ _id: 'message', content: 'attempt', senderId: { _id: 'user', fullName: 'Buyer', role: 'buyer' }, isBlocked: true, isFlagged: true }]) }
    for (const name of ['populate', 'sort', 'skip', 'limit']) chain[name].mockReturnValue(chain)
    const find = jest.fn().mockReturnValue(chain)
    const service = new AdminService({} as never, {} as never, {} as never, {} as never, { find, countDocuments: jest.fn().mockResolvedValue(1) } as never)
    const result = await service.getChatHistory('507f1f77bcf86cd799439011', 2, 50)
    expect(Object.keys(find.mock.calls[0][0])).toEqual(['dealId'])
    expect(chain.skip).toHaveBeenCalledWith(50)
    expect(result.messages[0].isBlocked).toBe(true)
    await expect(service.getChatHistory('invalid')).rejects.toThrow('Invalid deal ID')
  })
})
