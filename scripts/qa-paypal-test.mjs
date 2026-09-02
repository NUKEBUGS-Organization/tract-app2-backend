#!/usr/bin/env node
/**
 * PayPal platform-fee flow (skipped when PAYPAL_CLIENT_ID unset).
 * Usage: node scripts/qa-paypal-test.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { api, auth, createDealFixture, createRedis } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const stamp = Date.now()

async function main() {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim()

  console.log(`\n💳 TRACT PayPal QA\n`)

  if (!clientId || !clientSecret || clientId === 'not-configured') {
    console.log('⏭️  Skipped — set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET for live sandbox test.\n')
    process.exit(0)
  }

  const redis = createRedis()
  const { buyer, dealId } = await createDealFixture(redis, stamp)

  let res = await api(`/payments/deal/${dealId}`, { headers: auth(buyer.accessToken) })
  if (!res.ok) throw new Error(`getDealFees ${res.status}`)
  const payments = res.body.data?.payments ?? []
  const buyerPayment = payments.find((p) => p.party === 'buyer')
  if (!buyerPayment?.id) throw new Error('no buyer platform_fee payment row')

  res = await api('/payments/paypal/create-order', {
    method: 'POST',
    headers: auth(buyer.accessToken),
    body: JSON.stringify({ paymentId: buyerPayment.id }),
  })
  if (!res.ok) throw new Error(`create-order ${res.status} ${JSON.stringify(res.body)}`)

  const orderId = res.body.data?.orderId ?? res.body.data?.paypalOrderId
  const approveUrl = res.body.data?.approveUrl
  if (!orderId) throw new Error('missing orderId in create-order response')

  console.log(`✅ PayPal create-order succeeded (orderId=${orderId})`)
  if (approveUrl) console.log(`   Approve URL: ${approveUrl.slice(0, 80)}...`)
  console.log('   (Capture requires manual sandbox approval — not automated here.)\n')

  await redis.quit().catch(() => undefined)
  process.exit(0)
}

main().catch((e) => {
  console.error('❌ PayPal QA failed:', e.message)
  process.exit(1)
})
