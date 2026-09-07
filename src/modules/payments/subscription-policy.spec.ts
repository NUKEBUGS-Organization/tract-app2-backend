import { subscriptionAmount, paidThrough } from './subscription-policy'

describe('monthly SaaS entitlement', () => {
  it('uses the user-approved tiers', () => {
    expect(subscriptionAmount('wholesaler')).toBe(50)
    expect(subscriptionAmount('buyer')).toBe(100)
    expect(subscriptionAmount('realtor')).toBe(100)
    expect(subscriptionAmount('admin')).toBeNull()
  })
  it('does not grant access for approval without a completed payment', () => {
    expect(paidThrough({ status: 'ACTIVE' }, 50)).toBeNull()
  })
  it('rejects wrong amount, currency and suspended subscriptions', () => {
    const info = { last_payment: { amount: { value: '50.00', currency_code: 'USD' }, time: '2026-01-31T10:00:00Z' } }
    expect(paidThrough({ status: 'ACTIVE', billing_info: info }, 100)).toBeNull()
    expect(paidThrough({ status: 'SUSPENDED', billing_info: info }, 50)).toBeNull()
    expect(paidThrough({ status: 'ACTIVE', billing_info: { ...info, last_payment: { ...info.last_payment, amount: { value: '50', currency_code: 'EUR' } } } }, 50)).toBeNull()
  })
  it('clamps calendar months and preserves paid access after cancellation', () => {
    const info = { last_payment: { amount: { value: '50.00', currency_code: 'USD' }, time: '2026-01-31T10:00:00Z' } }
    expect(paidThrough({ status: 'CANCELLED', billing_info: info }, 50)?.toISOString()).toBe('2026-02-28T10:00:00.000Z')
  })
  it('never uses a next billing date to extend an unpaid period', () => {
    expect(paidThrough({ status: 'ACTIVE', billing_info: { next_billing_time: '2027-01-01T00:00:00Z', last_payment: { amount: { value: '100', currency_code: 'USD' }, time: '2026-09-07T00:00:00Z' } } }, 100)?.toISOString()).toBe('2026-10-07T00:00:00.000Z')
  })
})
