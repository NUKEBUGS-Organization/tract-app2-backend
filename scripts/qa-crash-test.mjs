#!/usr/bin/env node
/**
 * Adversarial / crash-hunt tests against running API.
 * Usage: node scripts/qa-crash-test.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Redis from 'ioredis'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const API_ROOT = API.replace(/\/api\/v1$/, '')
const stamp = Date.now() + Math.floor(Math.random() * 100_000)

const findings = []
let serverDown = false

function finding(severity, name, detail) {
  findings.push({ severity, name, detail })
  const icon = severity === 'crash' ? '💥' : severity === 'bug' ? '🐛' : '⚠️'
  console.log(`${icon} [${severity}] ${name}: ${detail}`)
}

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    return { status: res.status, body, ok: res.ok, crashed: false }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/ECONNREFUSED|fetch failed|timeout/i.test(msg)) {
      serverDown = true
      return { status: 0, body: null, ok: false, crashed: true, error: msg }
    }
    return { status: 0, body: null, ok: false, crashed: false, error: msg }
  }
}

async function health(retries = 5) {
  for (let i = 0; i < retries; i++) {
    const r = await api('/auth/states')
    if (r.ok && !r.crashed) return true
    await new Promise((res) => setTimeout(res, 500 * (i + 1)))
  }
  return false
}

async function registerBuyer(redis, offset) {
  const email = `crash_buyer_${stamp + offset}@test.com`
  const phone = `+1${String(stamp + offset).slice(-10).padStart(10, '0')}`
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  const otp = await redis.get(`otp:email:${email}`)
  await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, emailOtp: otp }) })
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Crash Tester',
      email,
      phone,
      password: 'Password1',
      role: 'buyer',
      dob: '1990-01-01',
      stateCode: 'TX',
    }),
  })
  return { email, token: reg.body?.data?.accessToken, userId: reg.body?.data?.user?.id }
}

async function loginAdmin(redis) {
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'wasifzahoor296@gmail.com', password: 'admin1234!' }),
  })
  const otp = await redis.get('otp:email:login:wasifzahoor296@gmail.com')
  const v = await api('/auth/verify-login-otp', {
    method: 'POST',
    body: JSON.stringify({ email: 'wasifzahoor296@gmail.com', otp }),
  })
  return v.body?.data?.accessToken
}

async function runRound(name, fn) {
  if (serverDown) return
  if (!(await health())) {
    serverDown = true
    finding('crash', name, 'Server unreachable before test')
    return
  }
  try {
    await fn()
  } catch (e) {
    finding('bug', name, e instanceof Error ? e.message : String(e))
  }
  if (!(await health())) {
    serverDown = true
    finding('crash', name, 'Server died during test')
  }
}

async function main() {
  console.log(`\n🔨 TRACT crash hunt — ${API}\n`)
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

  // ── 1. Malformed / adversarial inputs (should never 500) ───────
  const badPayloads = [
    ['POST /auth/login empty', '/auth/login', { method: 'POST', body: '{}' }],
    ['POST /auth/login garbage email', '/auth/login', { method: 'POST', body: JSON.stringify({ email: 'not-an-email', password: 'x' }) }],
    ['POST /auth/register missing fields', '/auth/register', { method: 'POST', body: JSON.stringify({ email: 'a@b.com' }) }],
    ['GET /listings/bad-id', '/listings/not-a-valid-object-id', {}],
    ['GET /deals/bad-id', '/deals/000000000000000000000000', {}],
    ['POST /bids negative price', '/bids', { method: 'POST', body: JSON.stringify({ listingId: 'x', assignmentPrice: -1 }) }],
    ['POST /deals/advance skip step', '/deals/000000000000000000000000/advance', { method: 'POST', body: JSON.stringify({ step: 'funded_closed' }) }],
    ['GET /users/me bad token', '/users/me', { headers: { Authorization: 'Bearer invalid.jwt.token' } }],
    ['POST /auth/verify-login-otp empty', '/auth/verify-login-otp', { method: 'POST', body: '{}' }],
    ['POST /tickets huge subject', '/tickets', { method: 'POST', body: JSON.stringify({ subject: 'x'.repeat(5000), description: 'y'.repeat(20000) }) }],
  ]

  for (const [label, path, opts] of badPayloads) {
    await runRound(label, async () => {
      const r = await api(path, opts)
      if (r.crashed) return
      if (r.status === 500) {
        finding('bug', label, `Returned 500: ${JSON.stringify(r.body)?.slice(0, 200)}`)
      }
    })
  }

  // ── 2. Webhook abuse ───────────────────────────────────────────
  await runRound('DocuSeal webhook invalid secret', async () => {
    const r = await fetch(`${API_ROOT}/webhooks/docuseal-app2/wrong-secret`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: 'submitter_completed', data: {} }),
    })
    if (r.status === 500) finding('bug', 'DocuSeal bad secret', '500 instead of 401')
  })

  await runRound('DocuSeal webhook malformed body', async () => {
    const secret = process.env.DOCUSEAL_WEBHOOK_SECRET ?? 'dev-local-webhook-secret'
    const r = await fetch(`${API_ROOT}/webhooks/docuseal-app2/${secret}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    })
    if (r.status === 500) finding('bug', 'DocuSeal malformed JSON', '500 on bad JSON')
  })

  // ── 3. Race: parallel duplicate registration ─────────────────
  await runRound('Parallel duplicate registration', async () => {
    const email = `race_${stamp}@test.com`
    const phone = `+1${String(stamp).slice(-10).padStart(10, '0')}`
    await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
    const otp = await redis.get(`otp:email:${email}`)
    await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, emailOtp: otp }) })
    const body = JSON.stringify({
      fullName: 'Race',
      email,
      phone,
      password: 'Password1',
      role: 'buyer',
      dob: '1990-01-01',
      stateCode: 'TX',
    })
    const results = await Promise.all(
      Array.from({ length: 10 }, () => api('/auth/register', { method: 'POST', body })),
    )
    const successes = results.filter((r) => r.status === 201).length
    const conflicts = results.filter((r) => r.status === 409).length
    const fives = results.filter((r) => r.status === 500).length
    if (fives > 0) finding('bug', 'Parallel register', `${fives} requests returned 500`)
    if (successes > 1) finding('bug', 'Parallel register', `${successes} duplicate accounts created (expected 1)`)
    if (successes === 1 && conflicts === 0 && fives === 0) {
      console.log('  ✓ Parallel register handled correctly (1 success, rest conflict/4xx)')
    }
  })

  // ── 4. Deal advance out of order / double advance ────────────
  await runRound('Deal double-advance race', async () => {
    const buyer = await registerBuyer(redis, 100)
    const wholesaler = await registerBuyer(redis, 101) // wrong role - need wholesaler
    if (!buyer.token) return

    // quick wholesaler reg
    const wEmail = `crash_wh_${stamp}@test.com`
    const wPhone = `+1${String(stamp + 99).slice(-10).padStart(10, '0')}`
    await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: wEmail }) })
    const wOtp = await redis.get(`otp:email:${wEmail}`)
    await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: wEmail, emailOtp: wOtp }) })
    const wReg = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'W',
        email: wEmail,
        phone: wPhone,
        password: 'Password1',
        role: 'wholesaler',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    const wToken = wReg.body?.data?.accessToken
    const admin = await loginAdmin(redis)
    if (!wToken || !admin) return

    let r = await api('/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({ dealType: 'fix_flip' }),
    })
    const listingId = r.body?.data?._id
    await api(`/listings/${listingId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({
        propertyAddress: '1 Crash Ln',
        city: 'Austin',
        stateCode: 'TX',
        zipCode: '78701',
        arv: 300000,
        assignmentFeeHigh: 10000,
      }),
    })
    await api(`/listings/${listingId}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${wToken}` } })
    await api(`/admin/listings/${listingId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ action: 'approve' }),
    })
    r = await api('/bids', {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}` },
      body: JSON.stringify({ listingId, assignmentPrice: 12000 }),
    })
    const bidId = r.body?.data?._id
    await api(`/bids/listing/${listingId}/select`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({ primaryBidId: bidId }),
    })

    // seed signed contract via mongoose inline - skip if no mongo
    const mongoose = (await import('mongoose')).default
    await mongoose.connect(process.env.MONGODB_URI)
    const contracts = mongoose.connection.db.collection('contracts')
    const now = new Date()
    await contracts.deleteMany({ bidId: new mongoose.Types.ObjectId(bidId) })
    const { insertedId } = await contracts.insertOne({
      listingId: new mongoose.Types.ObjectId(listingId),
      bidId: new mongoose.Types.ObjectId(bidId),
      wholesalerId: new mongoose.Types.ObjectId(wReg.body.data.user.id),
      buyerId: new mongoose.Types.ObjectId(buyer.userId),
      status: 'signed',
      assignmentFeeFinal: 12000,
      pdfUrl: 'https://example.com/c.pdf',
      wholesalerSignedAt: now,
      buyerSignedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    await mongoose.disconnect()

    r = await api('/deals', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({
        listingId,
        primaryBidId: bidId,
        primaryBuyerId: buyer.userId,
        wholesalerId: wReg.body.data.user.id,
      }),
    })
    const dealId = r.body?.data?._id
    if (!dealId) return

    const advances = await Promise.all(
      Array.from({ length: 5 }, () =>
        api(`/deals/${dealId}/advance`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${admin}` },
          body: JSON.stringify({ step: 'emd_deposited' }),
        }),
      ),
    )
    const fives = advances.filter((x) => x.status === 500).length
    if (fives > 0) finding('bug', 'Deal double-advance', `${fives} parallel advances returned 500`)
  })

  // ── 5. Flood health endpoint ─────────────────────────────────
  await runRound('Health endpoint flood (200 concurrent)', async () => {
    const batch = await Promise.all(Array.from({ length: 200 }, () => api('/auth/states')))
    const fives = batch.filter((r) => r.status === 500).length
    const down = batch.filter((r) => r.crashed).length
    if (fives > 0) finding('bug', 'Health flood', `${fives} x 500`)
    if (down > 0) finding('crash', 'Health flood', `${down} connection failures`)
  })

  // ── 6. Parallel duplicate bids (same buyer) ───────────────────
  await runRound('Parallel duplicate bids same buyer', async () => {
    const buyer = await registerBuyer(redis, 200)
    const wEmail = `crash_wh2_${stamp}@test.com`
    const wPhone = `+1${String(stamp + 201).slice(-10).padStart(10, '0')}`
    await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: wEmail }) })
    const wOtp = await redis.get(`otp:email:${wEmail}`)
    await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: wEmail, emailOtp: wOtp }) })
    const wReg = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'W2',
        email: wEmail,
        phone: wPhone,
        password: 'Password1',
        role: 'wholesaler',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    const wToken = wReg.body?.data?.accessToken
    const admin = await loginAdmin(redis)
    if (!buyer.token || !wToken || !admin) return

    let r = await api('/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({ dealType: 'fix_flip' }),
    })
    const listingId = r.body?.data?._id
    await api(`/listings/${listingId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({
        propertyAddress: '2 Bid Race Rd',
        city: 'Houston',
        stateCode: 'TX',
        zipCode: '77001',
        arv: 250000,
        assignmentFeeHigh: 8000,
      }),
    })
    await api(`/listings/${listingId}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${wToken}` } })
    await api(`/admin/listings/${listingId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ action: 'approve' }),
    })

    const bidBody = JSON.stringify({ listingId, assignmentPrice: 9000 })
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        api('/bids', { method: 'POST', headers: { Authorization: `Bearer ${buyer.token}` }, body: bidBody }),
      ),
    )
    const fives = attempts.filter((x) => x.status === 500).length
    const created = attempts.filter((x) => x.status === 201).length
    if (fives > 0) finding('bug', 'Parallel bids', `${fives} returned 500`)
    if (created > 1) finding('bug', 'Parallel bids', `${created} duplicate bids created`)
  })

  // ── 7. Listing patch with invalid types ─────────────────────
  await runRound('Listing patch NaN/overflow values', async () => {
    const wEmail = `crash_wh3_${stamp}@test.com`
    const wPhone = `+1${String(stamp + 301).slice(-10).padStart(10, '0')}`
    await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: wEmail }) })
    const wOtp = await redis.get(`otp:email:${wEmail}`)
    await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: wEmail, emailOtp: wOtp }) })
    const wReg = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'W3',
        email: wEmail,
        phone: wPhone,
        password: 'Password1',
        role: 'wholesaler',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    const wToken = wReg.body?.data?.accessToken
    if (!wToken) return
    const r = await api('/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({ dealType: 'fix_flip' }),
    })
    const listingId = r.body?.data?._id
    const badPatches = [
      { arv: 'not-a-number' },
      { arv: -999999999999 },
      { stateCode: 'ZZ' },
      { purchasePrice: null },
    ]
    for (const patch of badPatches) {
      const pr = await api(`/listings/${listingId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${wToken}` },
        body: JSON.stringify(patch),
      })
      if (pr.status === 500) finding('bug', `Listing patch ${JSON.stringify(patch)}`, '500')
    }
  })

  // ── 8. Auth refresh with no cookie ────────────────────────────
  await runRound('Refresh without cookie', async () => {
    const r = await api('/auth/refresh', { method: 'POST' })
    if (r.status === 500) finding('bug', 'Refresh no cookie', '500')
  })

  // ── 9. Double select bids on same listing ─────────────────────
  await runRound('Double select-bids race', async () => {
    const buyer = await registerBuyer(redis, 400)
    const buyer2 = await registerBuyer(redis, 401)
    const wEmail = `crash_wh4_${stamp}@test.com`
    const wPhone = `+1${String(stamp + 402).slice(-10).padStart(10, '0')}`
    await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email: wEmail }) })
    const wOtp = await redis.get(`otp:email:${wEmail}`)
    await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email: wEmail, emailOtp: wOtp }) })
    const wReg = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'W4',
        email: wEmail,
        phone: wPhone,
        password: 'Password1',
        role: 'wholesaler',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    const wToken = wReg.body?.data?.accessToken
    const admin = await loginAdmin(redis)
    if (!buyer.token || !buyer2.token || !wToken || !admin) return

    let r = await api('/listings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({ dealType: 'fix_flip' }),
    })
    const listingId = r.body?.data?._id
    await api(`/listings/${listingId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${wToken}` },
      body: JSON.stringify({
        propertyAddress: '3 Select Race',
        city: 'Dallas',
        stateCode: 'TX',
        zipCode: '75202',
        arv: 320000,
        assignmentFeeHigh: 11000,
      }),
    })
    await api(`/listings/${listingId}/publish`, { method: 'POST', headers: { Authorization: `Bearer ${wToken}` } })
    await api(`/admin/listings/${listingId}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}` },
      body: JSON.stringify({ action: 'approve' }),
    })
    r = await api('/bids', {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer.token}` },
      body: JSON.stringify({ listingId, assignmentPrice: 10000 }),
    })
    const bid1 = r.body?.data?._id
    r = await api('/bids', {
      method: 'POST',
      headers: { Authorization: `Bearer ${buyer2.token}` },
      body: JSON.stringify({ listingId, assignmentPrice: 10500 }),
    })
    const bid2 = r.body?.data?._id

    const selects = await Promise.all([
      api(`/bids/listing/${listingId}/select`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${wToken}` },
        body: JSON.stringify({ primaryBidId: bid1 }),
      }),
      api(`/bids/listing/${listingId}/select`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${wToken}` },
        body: JSON.stringify({ primaryBidId: bid2 }),
      }),
    ])
    const fives = selects.filter((x) => x.status === 500).length
    if (fives > 0) finding('bug', 'Double select-bids', `${fives} returned 500`)
  })

  await redis.quit().catch(() => undefined)

  console.log('\n────────────────────────────────')
  if (serverDown) {
    console.log('💥 SERVER CRASHED OR UNREACHABLE')
  } else if (findings.length === 0) {
    console.log('✅ No crashes or 500s found in this round')
  } else {
    const bugs = findings.filter((f) => f.severity !== 'crash')
    const crashes = findings.filter((f) => f.severity === 'crash')
    console.log(`Found ${bugs.length} bug(s), ${crashes.length} crash(es)`)
  }

  process.exit(serverDown || findings.some((f) => f.severity === 'bug' || f.severity === 'crash') ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
