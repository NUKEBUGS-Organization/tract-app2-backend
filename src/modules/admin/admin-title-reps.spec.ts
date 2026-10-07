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
