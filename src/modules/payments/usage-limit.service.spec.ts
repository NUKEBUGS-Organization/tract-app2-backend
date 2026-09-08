import { ForbiddenException } from '@nestjs/common'
import { UsageLimitService } from './usage-limit.service'

const id = '507f1f77bcf86cd799439011'

function setup({ used = 0, active = false }: { used?: number; active?: boolean } = {}) {
  const rows = new Map<string, { used: number }>()
  if (used) rows.set(`${id}:listing`, { used })

  const counters = {
    findOne: jest.fn((query: { userId: { toString(): string }; kind: string }) => ({
      lean: () => ({ exec: async () => rows.get(`${query.userId.toString()}:${query.kind}`) ?? null }),
    })),
    findOneAndUpdate: jest.fn((query: { userId: { toString(): string }; kind: string; used?: { $lt: number } }, update: { $inc?: { used: number } }, options: { upsert?: boolean }) => ({
      exec: async () => {
        const key = `${query.userId.toString()}:${query.kind}`
        const row = rows.get(key)
        if (row && query.used?.$lt !== undefined && row.used >= query.used.$lt) {
          const error = Object.assign(new Error('duplicate key'), { code: 11000 })
          throw error
        }
        const next = row ?? { used: 0 }
        next.used += update.$inc?.used ?? 0
        rows.set(key, next)
        return { ...next }
      },
    })),
    updateOne: jest.fn((query: { userId: { toString(): string }; kind: string; used?: { $gt: number } }, update: { $inc?: { used: number } }) => ({
      exec: async () => {
        const row = rows.get(`${query.userId.toString()}:${query.kind}`)
        if (row && (!query.used || row.used > query.used.$gt)) row.used += update.$inc?.used ?? 0
      },
    })),
  }
  const subscriptions = { getStatus: jest.fn(async () => ({ active })) }
  return { service: new UsageLimitService(counters as never, subscriptions as never), counters, rows, subscriptions }
}

describe('UsageLimitService', () => {
  it('allows the first ten lifetime attempts and reports the remaining allowance', async () => {
    const { service } = setup()

    for (let used = 1; used <= 10; used += 1) {
      await expect(service.consumeAttempt(id, 'listing')).resolves.toEqual({
        used,
        freeLimit: 10,
        remaining: 10 - used,
        subscriptionRequired: false,
      })
    }
  })

  it('rejects the unpaid eleventh attempt without incrementing the counter', async () => {
    const { service, rows } = setup({ used: 10 })

    await expect(service.consumeAttempt(id, 'listing')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SUBSCRIPTION_REQUIRED' }),
    } as ForbiddenException)
    expect(rows.get(`${id}:listing`)).toEqual({ used: 10 })
  })

  it('allows an active subscriber after the free allowance is exhausted', async () => {
    const { service, rows } = setup({ used: 10, active: true })

    await expect(service.consumeAttempt(id, 'listing')).resolves.toEqual({
      used: 11,
      freeLimit: 10,
      remaining: 0,
      subscriptionRequired: false,
    })
    expect(rows.get(`${id}:listing`)).toEqual({ used: 11 })
  })

  it('allows exactly the remaining quota under concurrent requests', async () => {
    const { service, rows } = setup({ used: 8 })

    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => service.consumeAttempt(id, 'listing')))

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(3)
    expect(rows.get(`${id}:listing`)).toEqual({ used: 10 })
  })

  it('releases only a failed persistence attempt and never releases a successful one automatically', async () => {
    const { service, rows } = setup()

    await service.consumeAttempt(id, 'listing')
    await service.compensateAttempt(id, 'listing')
    await service.consumeAttempt(id, 'listing')

    expect(rows.get(`${id}:listing`)).toEqual({ used: 1 })
  })
})
