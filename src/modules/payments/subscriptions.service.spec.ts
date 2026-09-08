import { ConfigService } from '@nestjs/config'
import { SubscriptionsService } from './subscriptions.service'

describe('subscription execution gate', () => {
  const id = '507f1f77bcf86cd799439011'
  function setup(row: Record<string, unknown> | null, details?: Record<string, unknown>, role = 'wholesaler') {
    const model = {
      findOne: jest.fn(() => ({ exec: async () => row })),
      findOneAndUpdate: jest.fn((_query, update) => ({ exec: async () => ({ ...row, ...update.$set }) })),
    }
    const users = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ role }) }) }) }) }
    const paypal = { subscriptionRequest: jest.fn().mockResolvedValue(details) }
    const service = new SubscriptionsService(model as never, users as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'paypal' }))
    return { service, model, paypal }
  }
  const row = { _id: id, userId: id, amount: 50, planId: 'P-50', paypalSubscriptionId: 'I-TEST', status: 'ACTIVE', revokedPaymentAt: null }
  const details = () => ({ id: 'I-TEST', custom_id: id, plan_id: 'P-50', status: 'ACTIVE', billing_info: { last_payment: { time: new Date().toISOString(), amount: { value: '50.00', currency_code: 'USD' } } } })
  it('skips all payment lookups in beta UI-only mock mode', async () => {
    const paypal = { subscriptionRequest: jest.fn() }
    const service = new SubscriptionsService({} as never, {} as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'mock' }))
    await expect(service.assertCanExecute(id)).resolves.toBeUndefined()
    expect(paypal.subscriptionRequest).not.toHaveBeenCalled()
  })
  it('records an idempotent paid test subscription without contacting PayPal in mock mode', async () => {
    const model = {
      findOneAndUpdate: jest.fn(() => ({ exec: async () => ({
        amount: 50, status: 'PAID_TEST', paidUntil: new Date(Date.now() + 86400000),
        paypalSubscriptionId: null, approvalUrl: null,
      }) })),
    }
    const users = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ role: 'wholesaler' }) }) }) }) }
    const paypal = { subscriptionRequest: jest.fn() }
    const service = new SubscriptionsService(model as never, users as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'mock' }))

    await expect((service as any).mockCheckout(id)).resolves.toMatchObject({ active: true, status: 'PAID_TEST' })
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { userId: expect.anything() },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'PAID_TEST', paypalSubscriptionId: null }) }),
      { upsert: true, new: true },
    )
    expect(paypal.subscriptionRequest).not.toHaveBeenCalled()
  })
  it('treats the legacy paypal subscribe action as mock checkout in mock mode', async () => {
    const model = {
      findOneAndUpdate: jest.fn(() => ({ exec: async () => ({
        amount: 100, status: 'PAID_TEST', paidUntil: new Date(Date.now() + 86400000),
        paypalSubscriptionId: null, approvalUrl: null,
      }) })),
    }
    const users = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ role: 'buyer' }) }) }) }) }
    const paypal = { subscriptionRequest: jest.fn() }
    const service = new SubscriptionsService(model as never, users as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'mock' }))

    await expect(service.create(id, '2026-09-07')).resolves.toMatchObject({
      active: true,
      amount: 100,
      status: 'PAID_TEST',
    })
    expect(paypal.subscriptionRequest).not.toHaveBeenCalled()
  })
  it('does not sync old PayPal rows while subscription mode is mock', async () => {
    const row = {
      _id: id,
      userId: id,
      amount: 100,
      planId: 'P-100',
      paypalSubscriptionId: 'I-LEGACY',
      status: 'ACTIVE',
      paidUntil: new Date(Date.now() + 86400000),
    }
    const model = { findOne: jest.fn(() => ({ exec: async () => row })) }
    const users = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ role: 'buyer' }) }) }) }) }
    const paypal = { subscriptionRequest: jest.fn() }
    const service = new SubscriptionsService(model as never, users as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'mock' }))

    await expect(service.getStatus(id, true)).resolves.toMatchObject({ active: true, status: 'ACTIVE' })
    expect(paypal.subscriptionRequest).not.toHaveBeenCalled()
  })
  it('ignores PayPal subscription webhooks in mock mode without resolving sale IDs', async () => {
    const paypal = { subscriptionRequest: jest.fn() }
    const service = new SubscriptionsService({} as never, {} as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'mock' }))

    await expect(service.handleWebhook({ event_type: 'PAYMENT.SALE.REFUNDED', resource: { sale_id: 'SALE-OLD' } })).resolves.toEqual({ received: true, ignored: true })
    expect(paypal.subscriptionRequest).not.toHaveBeenCalled()
  })
  it('rejects mock checkout outside mock mode', async () => {
    const service = new SubscriptionsService({} as never, {} as never, {} as never, new ConfigService({ SUBSCRIPTION_MODE: 'paypal' }))
    await expect((service as any).mockCheckout(id)).rejects.toThrow('only available in mock mode')
  })
  it('reuses the persisted PayPal request ID after an uncertain create response', async () => {
    const pending = { ...row, paypalSubscriptionId: null, status: 'CREATING', requestId: 'persisted-request' }
    const model = {
      findOne: () => ({ exec: async () => pending }),
      findOneAndUpdate: () => ({ exec: async () => pending }),
      updateOne: jest.fn(() => ({ exec: async () => ({}) })),
    }
    const users = { findById: () => ({ select: () => ({ lean: () => ({ exec: async () => ({ role: 'wholesaler' }) }) }) }) }
    const paypal = { subscriptionRequest: jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue({ id: 'I-TEST', status: 'APPROVAL_PENDING', links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/approval' }] }) }
    const service = new SubscriptionsService(model as never, users as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'paypal', paypal: { wholesalerPlanId: 'P-50' } }))
    await expect(service.create(id, '2026-09-07')).rejects.toThrow('timeout')
    await expect(service.create(id, '2026-09-07')).resolves.toMatchObject({ approvalUrl: 'https://www.sandbox.paypal.com/approval' })
    expect(paypal.subscriptionRequest.mock.calls.map(call => call[3])).toEqual(['persisted-request', 'persisted-request'])
    expect(model.updateOne).toHaveBeenCalledTimes(1)
  })
  it('blocks a user with no payment', async () => {
    await expect(setup(null).service.assertCanExecute(id)).rejects.toThrow('Pay your $50/month')
  })
  it('requires PayPal confirmation and does not trust locally active status', async () => {
    await expect(setup({ ...row, paidUntil: new Date(Date.now() + 999999) }, { ...details(), billing_info: {} }).service.assertCanExecute(id)).rejects.toThrow('Pay your $50/month')
  })
  it('rejects a subscription owned by another user', async () => {
    await expect(setup(row, { ...details(), custom_id: 'other' }).service.assertCanExecute(id)).rejects.toThrow('ownership or plan')
  })
  it('allows a verified paid monthly subscription', async () => {
    await expect(setup(row, details()).service.assertCanExecute(id)).resolves.toBeUndefined()
  })
  it('does not grant a realtor access for a wholesaler subscription', async () => {
    await expect(setup(row, details(), 'realtor').service.assertCanExecute(id)).rejects.toThrow('$100/month')
  })
  it('keeps refunded payments revoked even after an ACTIVE webhook', async () => {
    await expect(setup({ ...row, revokedPaymentAt: new Date(Date.now() + 1000) }, details()).service.assertCanExecute(id)).rejects.toThrow('Pay your')
  })
  it('resolves refund sale IDs and revokes the refunded cycle, not a newer payment', async () => {
    const currentPayment = new Date(Date.now() - 1000)
    const refundedPayment = new Date(currentPayment.getTime() - 32 * 86400000)
    const stored: Record<string, any> = { ...row, lastPaymentAt: currentPayment, paidUntil: new Date(Date.now() + 86400000) }
    const model = {
      findOne: jest.fn(() => ({ exec: async () => stored })),
      findById: jest.fn(() => ({ exec: async () => stored })),
      updateOne: jest.fn((_filter, update) => ({ exec: async () => {
        Object.assign(stored, update.$set)
        if (update.$max?.revokedPaymentAt > (stored.revokedPaymentAt ?? 0)) stored.revokedPaymentAt = update.$max.revokedPaymentAt
      } })),
      findOneAndUpdate: jest.fn((_filter, update) => ({ exec: async () => Object.assign(stored, update.$set) })),
    }
    const paypal = { subscriptionRequest: jest.fn().mockImplementation(async (_method, path) => path.includes('/sale/')
      ? { id: 'SALE-OLD', billing_agreement_id: 'I-TEST', create_time: refundedPayment.toISOString() }
      : { ...details(), billing_info: { last_payment: { time: currentPayment.toISOString(), amount: { value: '50.00', currency_code: 'USD' } } } }) }
    const service = new SubscriptionsService(model as never, {} as never, paypal as never, new ConfigService({ SUBSCRIPTION_MODE: 'paypal' }))
    await service.handleWebhook({ event_type: 'PAYMENT.SALE.REFUNDED', resource: { id: 'REFUND-ID', sale_id: 'SALE-OLD' } })
    expect(paypal.subscriptionRequest).toHaveBeenCalledWith('GET', '/v1/payments/sale/SALE-OLD')
    expect(stored.revokedPaymentAt).toEqual(refundedPayment)
    expect(stored.paidUntil.getTime()).toBeGreaterThan(Date.now())
    // A refund of the current payment must remain revoked after the authoritative sync.
    paypal.subscriptionRequest.mockImplementation(async (_method, path) => path.includes('/sale/')
      ? { id: 'SALE-NOW', billing_agreement_id: 'I-TEST', create_time: currentPayment.toISOString() }
      : { ...details(), billing_info: { last_payment: { time: currentPayment.toISOString(), amount: { value: '50.00', currency_code: 'USD' } } } })
    await service.handleWebhook({ event_type: 'PAYMENT.SALE.REFUNDED', resource: { sale_id: 'SALE-NOW' } })
    expect(stored.paidUntil).toBeNull()
  })
})
