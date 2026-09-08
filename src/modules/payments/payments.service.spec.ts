import { ForbiddenException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PaymentsService } from './payments.service'

describe('PaymentsService mock subscription mode', () => {
  const service = () =>
    new PaymentsService({} as never, {} as never, {} as never, new ConfigService({
      SUBSCRIPTION_MODE: 'mock',
      paypal: {
        clientId: 'test-client',
        clientSecret: 'test-secret',
        webhookId: 'test-webhook',
      },
    }))

  it('blocks direct PayPal subscription requests before fetch can run', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as never)

    await expect(service().subscriptionRequest('POST', '/v1/billing/subscriptions', {})).rejects.toBeInstanceOf(ForbiddenException)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })

  it('blocks PayPal webhook verification before fetch can run', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({} as never)

    await expect(service().verifyAndHandlePayPalWebhook({}, {
      'paypal-transmission-id': 'id',
      'paypal-transmission-time': 'time',
      'paypal-transmission-sig': 'sig',
      'paypal-cert-url': 'https://www.paypal.com/cert',
      'paypal-auth-algo': 'SHA256withRSA',
    })).rejects.toBeInstanceOf(ForbiddenException)
    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
