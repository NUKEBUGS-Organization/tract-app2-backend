import { AdminService } from './admin.service'
import { UserRole } from '../../common/enums/user-role.enum'
import { KycStatus } from '../../common/enums/kyc-status.enum'

function setup(existing: Record<string, unknown> | null = null) {
  const users = {
    findOne: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => existing }) }) })),
    create: jest.fn(async (doc: Record<string, unknown>) => ({ _id: { toString: () => 'rep1' }, ...doc })),
  }
  const hasher = { hash: jest.fn(async () => 'hashed') }
  const resend = { sendMail: jest.fn().mockResolvedValue(true) }
  const config = { get: jest.fn(() => 'https://buyer.example.test') }
  const service = new AdminService({} as never, {} as never, users as never, {} as never, {} as never,
    hasher as never, resend as never, config as never)
  return { service, users, hasher, resend }
}

const dto = { fullName: 'Tia Title', email: 'Tia@Title.test ', phone: '5555550100' }

describe('admin-created title representatives', () => {
  it('creates an approved title_rep and emails a set-password invite', async () => {
    const { service, users, resend } = setup()
    const result = await service.createTitleRep(dto)
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({
      role: UserRole.TITLE_REP, email: 'tia@title.test', phone: '+5555550100', kycStatus: KycStatus.APPROVED,
    }))
    const [to, , html] = resend.sendMail.mock.calls[0]
    expect(to).toBe('tia@title.test')
    expect(html).toContain('https://buyer.example.test/forgot-password?email=tia%40title.test')
    expect(result).toMatchObject({ id: 'rep1', inviteSent: true })
    expect(JSON.stringify(result)).not.toMatch(/password/i)
  })

  it('never stores a guessable password', async () => {
    const { service, hasher } = setup()
    await service.createTitleRep(dto)
    const [plain] = hasher.hash.mock.calls[0] as unknown as [string]
    expect(plain.length).toBeGreaterThanOrEqual(40)
  })

  it('rejects an email or phone that already has an account', async () => {
    await expect(setup({ email: 'tia@title.test' }).service.createTitleRep(dto)).rejects.toThrow('email already exists')
    await expect(setup({ email: 'other@x.test' }).service.createTitleRep(dto)).rejects.toThrow('phone number already exists')
  })

  it('still creates the account when the invite email fails', async () => {
    const { service, resend } = setup()
    resend.sendMail.mockResolvedValueOnce(false)
    await expect(service.createTitleRep(dto)).resolves.toMatchObject({ inviteSent: false })
  })
})

describe('deleting title representatives', () => {
  const repId = '507f1f77bcf86cd799439015'

  function deleteSetup(rep: Record<string, unknown> | null, activeDeals: number) {
    const users = {
      findOne: jest.fn(() => ({ select: () => ({ lean: () => ({ exec: async () => rep }) }) })),
      updateOne: jest.fn(() => ({ exec: async () => ({ modifiedCount: 1 }) })),
    }
    const deals = { countDocuments: jest.fn(() => ({ exec: async () => activeDeals })) }
    const sessions = { blacklistAllForUser: jest.fn().mockResolvedValue(undefined) }
    const service = new AdminService({} as never, deals as never, users as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, sessions as never)
    return { service, users, deals, sessions }
  }

  const rep = { _id: { toString: () => repId }, fullName: 'Tia Title', email: 'tia@title.test' }

  it('soft-deletes a rep with no active deals, frees the email and signs them out', async () => {
    const { service, users, deals, sessions } = deleteSetup(rep, 0)
    await expect(service.deleteTitleRep(repId)).resolves.toEqual({ deleted: true, id: repId })
    expect(deals.countDocuments).toHaveBeenCalledWith({ titleRepId: rep._id, currentStep: { $ne: 'funded_closed' } })
    expect(users.updateOne).toHaveBeenCalledWith(
      { _id: rep._id },
      {
        $set: { deletedAt: expect.any(Date), isBanned: true, email: `deleted.${repId}.tia@title.test` },
        $unset: { googleId: 1 },
      },
    )
    expect(sessions.blacklistAllForUser).toHaveBeenCalledWith(repId)
  })

  it('refuses while the rep still has active deals', async () => {
    const { service, users, sessions } = deleteSetup(rep, 2)
    await expect(service.deleteTitleRep(repId)).rejects.toThrow('still has 2 active deals')
    expect(users.updateOne).not.toHaveBeenCalled()
    expect(sessions.blacklistAllForUser).not.toHaveBeenCalled()
  })

  it('only deletes title reps', async () => {
    const { service, users } = deleteSetup(null, 0)
    await expect(service.deleteTitleRep(repId)).rejects.toThrow('not found')
    expect(users.findOne).toHaveBeenCalledWith(expect.objectContaining({ role: 'title_rep' }))
    expect(users.updateOne).not.toHaveBeenCalled()
  })
})
