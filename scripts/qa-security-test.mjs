#!/usr/bin/env node
/**
 * Attempt common exploits — expects all to be BLOCKED after security fixes.
 * Usage: node scripts/qa-security-test.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Redis from 'ioredis'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const API_ROOT = API.replace(/\/api\/v1$/, '')
const TEST_OTP = process.env.TEST_OTP_CODE ?? '123456'
const KYC_SECRET = process.env.KYC_WEBHOOK_SECRET ?? 'dev-local-kyc-secret'
const stamp = Date.now()

const results = []

function pass(name) {
  results.push({ name, ok: true })
  console.log(`✅ BLOCKED: ${name}`)
}

function fail(name, detail) {
  results.push({ name, ok: false, detail })
  console.error(`❌ EXPLOITABLE: ${name} — ${detail}`)
}

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, ok: res.ok }
}

async function loginBuyer(redis) {
  const email = `sec_buyer_${stamp}@test.com`
  const phone = `+1${String(stamp).slice(-10).padStart(10, '0')}`
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  const otp = await redis.get(`otp:email:${email}`)
  await api('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, emailOtp: otp }),
  })
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Sec Buyer',
      email,
      phone,
      password: 'Password1',
      role: 'buyer',
      dob: '1990-01-01',
      stateCode: 'TX',
    }),
  })
  return { token: reg.body?.data?.accessToken, email }
}

async function main() {
  console.log(`\n🔓 TRACT security exploit attempts — ${API}\n`)
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

  // 1. Register without OTP verify
  {
    const email = `hack_skip_otp_${stamp}@test.com`
    const phone = `+1${String(stamp + 1).slice(-10).padStart(10, '0')}`
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Hacker',
        email,
        phone,
        password: 'Password1',
        role: 'buyer',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    if (res.status === 201) fail('Registration without OTP', 'account created')
    else if (res.status === 403 || res.status === 400) pass('Registration without OTP')
    else fail('Registration without OTP', `unexpected ${res.status}`)
  }

  // 2. PDF IDOR — buyer reads another deal's contract PDF
  {
    const buyer = await loginBuyer(redis)
    await mongoose.connect(process.env.MONGODB_URI)
    const deal = await mongoose.connection.db.collection('deals').findOne({})
    await mongoose.disconnect()
    if (!buyer.token || !deal) {
      console.log('⏭️  PDF IDOR (skipped: no buyer token or deal in DB)')
    } else {
      const res = await api(`/pdf/contract/${deal._id}`, {
        headers: { Authorization: `Bearer ${buyer.token}` },
      })
      if (res.status === 200) fail('PDF contract IDOR', 'downloaded foreign deal PDF')
      else if (res.status === 403 || res.status === 404) pass('PDF contract IDOR')
      else fail('PDF contract IDOR', `status ${res.status}`)
    }
  }

  // 3. Forged PayPal webhook
  {
    const res = await api('/payments/paypal/webhook', {
      method: 'POST',
      body: JSON.stringify({
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { custom_id: '000000000000000000000001', id: 'fake-capture' },
      }),
    })
    if (res.status === 200 && res.body?.data?.ok === true) {
      fail('PayPal webhook forgery', 'webhook accepted without signature')
    } else if ([401, 403].includes(res.status)) pass('PayPal webhook forgery')
    else fail('PayPal webhook forgery', `status ${res.status}`)
  }

  // 4. Unauthenticated KYC approval
  {
    const res = await api('/auth/kyc/webhook', {
      method: 'POST',
      body: JSON.stringify({
        customerId: '000000000000000000000001',
        verificationStatus: 'APPROVED_VERIFIED',
      }),
    })
    if (res.status === 200) fail('KYC webhook forgery', 'accepted without secret')
    else if (res.status === 401 || res.status === 403) pass('KYC webhook forgery')
    else fail('KYC webhook forgery', `status ${res.status}`)
  }

  // 5. Draft listing enumeration
  {
    await mongoose.connect(process.env.MONGODB_URI)
    const draft = await mongoose.connection.db
      .collection('listings')
      .findOne({ status: { $in: ['draft', 'pending_review'] } })
    await mongoose.disconnect()
    if (!draft) {
      console.log('⏭️  Draft listing leak (skipped: no draft in DB)')
    } else {
      const res = await api(`/listings/${draft._id}`)
      if (res.status === 200 && res.body?.data?.status !== 'live') {
        fail('Draft listing public read', `exposed status=${res.body?.data?.status}`)
      } else if (res.status === 404) pass('Draft listing public read')
      else fail('Draft listing public read', `status ${res.status}`)
    }
  }

  // 6. DocuSeal forged role in webhook
  {
    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET ?? 'dev-local-webhook-secret'
    await mongoose.connect(process.env.MONGODB_URI)
    const contract = await mongoose.connection.db
      .collection('contracts')
      .findOne({ status: { $ne: 'signed' } })
    await mongoose.disconnect()
    if (!contract) {
      console.log('⏭️  DocuSeal role spoof (skipped: no unsigned contract)')
    } else {
      const res = await fetch(`${API_ROOT}/webhooks/docuseal-app2/${secret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_type: 'submitter_completed',
          data: {
            external_id: `${contract._id}:lister`,
            role: 'purchaser',
            submission_id: contract.docusealSubmissionId ?? 'fake',
          },
        }),
      })
      await mongoose.connect(process.env.MONGODB_URI)
      const after = await mongoose.connection.db
        .collection('contracts')
        .findOne({ _id: contract._id })
      await mongoose.disconnect()
      const spoofedBoth =
        after?.buyerSignedAt && !contract.buyerSignedAt && !contract.docusealBuyerSubmitterId
      if (spoofedBoth) fail('DocuSeal role spoof', 'buyer marked signed via forged role')
      else pass('DocuSeal role spoof')
    }
  }

  await redis.quit().catch(() => undefined)

  console.log('\n────────────────────────────────')
  const bad = results.filter((r) => !r.ok)
  if (bad.length === 0) {
    console.log(`All ${results.length} exploit attempts blocked.\n`)
    process.exit(0)
  }
  console.log(`${bad.length}/${results.length} vulnerabilities still exploitable\n`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
