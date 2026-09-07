export function subscriptionAmount(role: string): number | null {
  if (role === 'wholesaler') return 50
  if (role === 'buyer' || role === 'realtor') return 100
  return null
}

export interface PaypalSubscriptionDetails {
  id?: string
  plan_id?: string
  custom_id?: string
  status?: string
  links?: Array<{ rel: string; href: string }>
  billing_info?: {
    last_payment?: { amount?: { value?: string; currency_code?: string }; time?: string }
    next_billing_time?: string
  }
}

/** Approval is not payment. Never infer entitlement from ACTIVE alone. */
export function paidThrough(details: PaypalSubscriptionDetails, amount: number): Date | null {
  if (!['ACTIVE', 'CANCELLED', 'EXPIRED'].includes(details.status ?? '')) return null
  const payment = details.billing_info?.last_payment
  if (payment?.amount?.currency_code !== 'USD' || Number(payment.amount.value) !== amount) return null
  const paidAt = new Date(payment.time ?? '')
  if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now() + 60_000) return null
  const end = new Date(paidAt)
  const day = end.getUTCDate()
  end.setUTCDate(1)
  end.setUTCMonth(end.getUTCMonth() + 1)
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate()
  end.setUTCDate(Math.min(day, lastDay))
  const next = new Date(details.billing_info?.next_billing_time ?? '')
  return Number.isFinite(next.getTime()) && next > paidAt && next < end ? next : end
}
