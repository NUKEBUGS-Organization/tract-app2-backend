// Provision sandbox plans only; never charges or creates a subscriber.
require('dotenv').config({ quiet: true })
const fs = require('node:fs')
async function main() {
  if ((process.env.PAYPAL_MODE || 'sandbox') !== 'sandbox') throw new Error('This setup script only supports sandbox.')
  const base = 'https://api-m.sandbox.paypal.com'
  const client = process.env.PAYPAL_CLIENT_ID?.trim()
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim()
  if (!client || !secret) throw new Error('Configure PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env.')
  const auth = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  if (!auth.ok) throw new Error(`Sandbox authentication failed (HTTP ${auth.status}); check the matching Client ID and Secret.`)
  const token = (await auth.json()).access_token
  async function request(method, path, body, key) {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(key ? { 'PayPal-Request-Id': key } : {}) }, body: body ? JSON.stringify(body) : undefined })
    if (!response.ok) throw new Error(`PayPal ${path} failed (HTTP ${response.status}).`)
    return response.status === 204 ? null : response.json()
  }
  const setEnv = (key, value) => {
    let content = fs.readFileSync('.env', 'utf8')
    const pattern = new RegExp(`^${key}=.*$`, 'm')
    content = pattern.test(content) ? content.replace(pattern, `${key}=${value}`) : `${content}\n${key}=${value}\n`
    fs.writeFileSync('.env', content)
    process.env[key] = value
  }
  let productId = process.env.PAYPAL_SUBSCRIPTION_PRODUCT_ID
  if (!productId) {
    productId = (await request('POST', '/v1/catalogs/products', { name: 'Buy TRACT Beta SaaS', description: 'Digital clearinghouse and contract tools', type: 'SERVICE', category: 'SOFTWARE' }, 'tract-beta-product-20260907')).id
    setEnv('PAYPAL_SUBSCRIPTION_PRODUCT_ID', productId)
  }
  for (const [key, amount, label] of [['PAYPAL_WHOLESALER_PLAN_ID', 50, 'Wholesaler / Asset Provider'], ['PAYPAL_BUYER_PLAN_ID', 100, 'Buyer / Investor / Realtor']]) {
    if (!process.env[key]) {
      const plan = await request('POST', '/v1/billing/plans', { product_id: productId, name: `${label} Monthly Beta`, status: 'ACTIVE', billing_cycles: [{ frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: `${amount}.00`, currency_code: 'USD' } } }], payment_preferences: { auto_bill_outstanding: false, payment_failure_threshold: 1 } }, `tract-beta-plan-${amount}-20260907`)
      setEnv(key, plan.id)
    }
    const plan = await request('GET', `/v1/billing/plans/${process.env[key]}`)
    const regular = plan.billing_cycles?.find((cycle) => cycle.tenure_type === 'REGULAR')
    if (plan.status !== 'ACTIVE' || regular?.frequency?.interval_unit !== 'MONTH' || regular.frequency.interval_count !== 1 || Number(regular.pricing_scheme?.fixed_price?.value) !== amount || regular.pricing_scheme.fixed_price.currency_code !== 'USD') throw new Error(`${key} does not match the required monthly price.`)
    console.log(`Verified ${label}: USD ${amount}/month.`)
  }
  const publicUrl = process.env.API_PUBLIC_URL?.replace(/\/$/, '')
  if (publicUrl?.startsWith('https://')) {
    const url = `${publicUrl}/${process.env.API_PREFIX || 'api/v1'}/payments/paypal/webhook`
    const event_types = ['BILLING.SUBSCRIPTION.ACTIVATED', 'BILLING.SUBSCRIPTION.CANCELLED', 'BILLING.SUBSCRIPTION.EXPIRED', 'BILLING.SUBSCRIPTION.SUSPENDED', 'BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PAYMENT.SALE.COMPLETED', 'PAYMENT.SALE.REFUNDED', 'PAYMENT.SALE.REVERSED'].map(name => ({ name }))
    const existing = (await request('GET', '/v1/notifications/webhooks')).webhooks?.find(hook => hook.url === url)
    if (existing) {
      await request('PATCH', `/v1/notifications/webhooks/${existing.id}`, [{ op: 'replace', path: '/event_types', value: event_types }])
      setEnv('PAYPAL_WEBHOOK_ID', existing.id)
    } else setEnv('PAYPAL_WEBHOOK_ID', (await request('POST', '/v1/notifications/webhooks', { url, event_types })).id)
    console.log('Sandbox webhook configured. Deploy the handler before testing recurring events.')
  } else console.log('Webhook needs a public HTTPS API_PUBLIC_URL; plans are ready.')
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
