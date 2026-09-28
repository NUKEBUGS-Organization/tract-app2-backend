import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Types } from 'mongoose'
import { CouponsService } from './coupons.service'

const FUTURE = new Date(Date.now() + 90 * 24 * 3600_000)
const PAST = new Date(Date.now() - 1000)

function makeCoupon(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    code: 'BETA100',
    description: 'Beta access',
    percentOff: 100,
    freeUntil: FUTURE,
    allowedRoles: [] as string[],
    maxRedemptions: null as number | null,
    redemptionCount: 0,
    active: true,
    ...overrides,
  }
}

function setup(options: {
  coupon?: ReturnType<typeof makeCoupon> | null
  role?: string
  existingRedemption?: boolean
  claimFails?: boolean
} = {}) {
  const coupon = options.coupon === undefined ? makeCoupon() : options.coupon
  const coupons = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(coupon) }),
    findOneAndUpdate: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(options.claimFails ? null : coupon),
    }),
    updateOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  }
  const redemptions = {
    findOne: jest.fn().mockReturnValue({
      lean: () => ({ exec: jest.fn().mockResolvedValue(options.existingRedemption ? {} : null) }),
    }),
    create: jest.fn().mockResolvedValue({}),
  }
  const subscriptions = {
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
  }
  const users = {
    findById: jest.fn().mockReturnValue({
      select: () => ({ lean: () => ({ exec: jest.fn().mockResolvedValue({ role: options.role ?? 'realtor' }) }) }),
    }),
  }
  const service = new CouponsService(
    coupons as never, redemptions as never, subscriptions as never, users as never,
    new ConfigService({}),
  )
  return { service, coupons, redemptions, subscriptions, userId: new Types.ObjectId().toString() }
}

describe('Coupon preview', () => {
  it('shows a realtor $100 dropping to $0 without consuming the code', async () => {
    const { service, userId, coupons, redemptions } = setup({ role: 'realtor' })
    await expect(service.preview(userId, 'beta100')).resolves.toMatchObject({
      code: 'BETA100', amountBefore: 100, amountDue: 0, percentOff: 100,
    })
    expect(coupons.findOneAndUpdate).not.toHaveBeenCalled()
    expect(redemptions.create).not.toHaveBeenCalled()
  })

  it('shows a wholesaler $50 dropping to $0', async () => {
    const { service, userId } = setup({ role: 'wholesaler' })
    await expect(service.preview(userId, 'BETA100')).resolves.toMatchObject({
      amountBefore: 50, amountDue: 0,
    })
  })

  it('rejects an unknown code', async () => {
    const { service, userId } = setup({ coupon: null })
    await expect(service.preview(userId, 'NOPE')).rejects.toThrow(NotFoundException)
  })

  it('rejects an expired code', async () => {
    const { service, userId } = setup({ coupon: makeCoupon({ freeUntil: PAST }) })
    await expect(service.preview(userId, 'BETA100')).rejects.toThrow(BadRequestException)
  })

  it('rejects a deactivated code', async () => {
    const { service, userId } = setup({ coupon: makeCoupon({ active: false }) })
    await expect(service.preview(userId, 'BETA100')).rejects.toThrow(NotFoundException)
  })

  it('rejects a role the code is not offered to', async () => {
    const { service, userId } = setup({ coupon: makeCoupon({ allowedRoles: ['realtor'] }), role: 'buyer' })
    await expect(service.preview(userId, 'BETA100')).rejects.toThrow(BadRequestException)
  })

  it('rejects a code that hit its redemption cap', async () => {
    const { service, userId } = setup({ coupon: makeCoupon({ maxRedemptions: 5, redemptionCount: 5 }) })
    await expect(service.preview(userId, 'BETA100')).rejects.toThrow(BadRequestException)
  })

  it('previews an already redeemed coupon so the client can recover the subscription status', async () => {
    const { service, userId } = setup({
      coupon: makeCoupon({ maxRedemptions: 5, redemptionCount: 5 }),
      existingRedemption: true,
    })
    await expect(service.preview(userId, 'BETA100')).resolves.toMatchObject({
      code: 'BETA100', amountBefore: 100, amountDue: 0, percentOff: 100,
    })
  })

  it('rejects a malformed code before touching the database', async () => {
    const { service, userId, coupons } = setup()
    await expect(service.preview(userId, 'a')).rejects.toThrow(NotFoundException)
    expect(coupons.findOne).not.toHaveBeenCalled()
  })
})

describe('Coupon redemption', () => {
  it('grants free access through the coupon window without a PayPal subscription', async () => {
    const { service, userId, subscriptions } = setup({ role: 'realtor' })
    await expect(service.redeem(userId, 'beta100')).resolves.toMatchObject({
      code: 'BETA100', amountBefore: 100, amountDue: 0, freeUntil: FUTURE,
    })
    const update = subscriptions.findOneAndUpdate.mock.calls[0][1].$set
    expect(update).toMatchObject({
      status: 'COUPON', amount: 100,
      couponCode: 'BETA100', couponAmountWaived: 100, paypalSubscriptionId: null,
    })
    expect(update.paidUntil.getTime()).toBeGreaterThan(Date.now() + 27 * 24 * 3600_000)
    expect(update.paidUntil.getTime()).toBeLessThan(FUTURE.getTime())
  })

  it('records the redemption so the code cannot be reused by the same user', async () => {
    const { service, userId, redemptions } = setup()
    await service.redeem(userId, 'BETA100')
    expect(redemptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'BETA100', amountWaived: 100, freeUntil: FUTURE }),
    )
  })

  it('treats a second redemption by the same user as an idempotent success', async () => {
    const { service, userId, coupons, redemptions, subscriptions } = setup({ existingRedemption: true })
    await expect(service.redeem(userId, 'BETA100')).resolves.toMatchObject({
      code: 'BETA100', amountBefore: 100, amountDue: 0, freeUntil: FUTURE,
    })
    expect(coupons.findOneAndUpdate).not.toHaveBeenCalled()
    expect(redemptions.create).not.toHaveBeenCalled()
    expect(subscriptions.findOneAndUpdate).toHaveBeenCalled()
  })

  it('does not grant access when the redemption slot cannot be claimed', async () => {
    const { service, userId, subscriptions } = setup({ claimFails: true })
    await expect(service.redeem(userId, 'BETA100')).rejects.toThrow(BadRequestException)
    expect(subscriptions.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('repairs access when a concurrent redemption already created the row', async () => {
    const { service, userId, redemptions, coupons, subscriptions } = setup()
    redemptions.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }))
    await expect(service.redeem(userId, 'BETA100')).resolves.toMatchObject({
      code: 'BETA100', amountBefore: 100, amountDue: 0, freeUntil: FUTURE,
    })
    expect(coupons.updateOne).toHaveBeenCalledWith(
      expect.anything(), { $inc: { redemptionCount: -1 } },
    )
    expect(subscriptions.findOneAndUpdate).toHaveBeenCalled()
  })

  it('refuses a partial-discount coupon rather than charging a surprise amount', async () => {
    const { service, userId } = setup({ coupon: makeCoupon({ percentOff: 50 }) })
    await expect(service.redeem(userId, 'BETA100')).rejects.toThrow(BadRequestException)
  })

  it('tells a non-paying role that no coupon is needed', async () => {
    const { service, userId } = setup({ role: 'title_rep' })
    await expect(service.redeem(userId, 'BETA100')).rejects.toThrow(BadRequestException)
  })
})
