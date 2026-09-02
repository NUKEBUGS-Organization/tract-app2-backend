#!/usr/bin/env node
/**
 * High-concurrency load against running API.
 * Usage: node scripts/qa-heavy-load.mjs [waves]
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Redis from 'ioredis'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const TEST_OTP = process.env.TEST_OTP_CODE ?? '123456'
const REALTOR_EMAIL = 'qaiserwaheed00@gmail.com'
const REALTOR_PASSWORD = 'Test1234!'
const waves = Math.max(1, parseInt(process.argv[2] ?? '3', 10))
const stamp = Date.now()

const stats = { ok: 0, err4xx: 0, err5xx: 0, down: 0, bugs: [] }

function bug(name, detail) {
  stats.bugs.push({ name, detail })
  console.error(`🐛 ${name}: ${detail}`)
}

async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`
  try {
    const res = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (res.status >= 500) stats.err5xx++
    else if (res.status >= 400) stats.err4xx++
    else stats.ok++
    return { status: res.status, body, ok: res.ok }
  } catch (err) {
    stats.down++
    return { status: 0, body: null, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function health() {
  const r = await api('/auth/states')
  return r.ok
}

async function registerFlow(redis, offset) {
  const email = `heavy_${stamp}_${offset}@test.com`
  const phone = `+1${String(stamp + offset).slice(-10).padStart(10, '0')}`
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  const otp = await redis.get(`otp:email:${email}`)
  if (!otp) return { ok: false, reason: 'no otp' }
  await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, emailOtp: otp }) })
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `Heavy ${offset}`,
      email,
      phone,
      password: 'Password1',
      role: offset % 2 === 0 ? 'buyer' : 'wholesaler',
      dob: '1990-01-01',
      stateCode: 'TX',
    }),
  })
  return { ok: reg.status === 201, status: reg.status, token: reg.body?.data?.accessToken }
}

async function loginRealtor() {
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: REALTOR_EMAIL, password: REALTOR_PASSWORD }),
  })
  if (!login.ok) return { ok: false, status: login.status }
  const verify = await api('/auth/verify-login-otp', {
    method: 'POST',
    body: JSON.stringify({ email: REALTOR_EMAIL, otp: TEST_OTP }),
  })
  return { ok: verify.ok, status: verify.status, token: verify.body?.data?.accessToken }
}

async function wave(n) {
  console.log(`\n🌊 Wave ${n}/${waves}`)
  if (!(await health())) {
    bug('health', 'API unreachable before wave')
    return false
  }

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

  // 1. Endpoint flood — scale with wave number
  const floodSize = 200 + n * 150
  console.log(`  → ${floodSize} concurrent GET /auth/states`)
  const flood = await Promise.all(Array.from({ length: floodSize }, () => api('/auth/states')))
  const flood5xx = flood.filter((r) => r.status >= 500).length
  if (flood5xx > 0) bug('states flood', `${flood5xx}/${floodSize} returned 5xx`)

  // 2. Parallel marketplace reads
  console.log('  → 150 concurrent GET /listings')
  const listings = await Promise.all(Array.from({ length: 150 }, () => api('/listings')))
  const list5xx = listings.filter((r) => r.status >= 500).length
  if (list5xx > 0) bug('listings flood', `${list5xx}/150 returned 5xx`)

  // 3. Parallel registration storms
  const regCount = 15 + n * 5
  console.log(`  → ${regCount} parallel registration flows`)
  const regs = await Promise.all(
    Array.from({ length: regCount }, (_, i) => registerFlow(redis, n * 1000 + i)),
  )
  const reg5xx = regs.filter((r) => r.status >= 500).length
  const regOk = regs.filter((r) => r.ok).length
  if (reg5xx > 0) bug('parallel register', `${reg5xx} flows hit 5xx`)
  console.log(`     ${regOk}/${regCount} registrations succeeded`)

  // 4. Parallel realtor logins (session churn)
  const loginCount = 20 + n * 10
  console.log(`  → ${loginCount} parallel realtor login+OTP cycles`)
  const logins = await Promise.all(Array.from({ length: loginCount }, () => loginRealtor()))
  const login5xx = logins.filter((r) => r.status >= 500).length
  const loginOk = logins.filter((r) => r.ok).length
  if (login5xx > 0) bug('parallel login', `${login5xx} cycles hit 5xx`)
  console.log(`     ${loginOk}/${loginCount} logins succeeded`)

  // 5. Authenticated write burst (listings + tickets)
  const token = logins.find((l) => l.token)?.token
  if (token) {
    console.log('  → 25 parallel draft listing creates')
    const creates = await Promise.all(
      Array.from({ length: 25 }, () =>
        api('/listings', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ dealType: 'fix_flip', marketStatus: 'off_market' }),
        }),
      ),
    )
    const create5xx = creates.filter((r) => r.status >= 500).length
    if (create5xx > 0) bug('parallel listing create', `${create5xx}/25 returned 5xx`)

    console.log('  → 15 parallel support tickets')
    const tickets = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        api('/tickets', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            subject: `Heavy load ticket ${stamp} w${n}-${i}`,
            description: `[Technical Issue]\n\nAutomated heavy load ticket wave ${n} item ${i} with enough detail.`,
          }),
        }),
      ),
    )
    const ticket5xx = tickets.filter((r) => r.status >= 500).length
    if (ticket5xx > 0) bug('parallel tickets', `${ticket5xx}/15 returned 5xx`)
  }

  // 6. Malformed payload spam (should never 500)
  console.log('  → 50 malformed auth payloads')
  const bad = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: i % 2 === 0 ? 'bad' : '', password: null }),
      }),
    ),
  )
  const bad5xx = bad.filter((r) => r.status >= 500).length
  if (bad5xx > 0) bug('malformed login spam', `${bad5xx}/50 returned 5xx`)

  await redis.quit().catch(() => undefined)

  const alive = await health()
  if (!alive) {
    bug('health', 'API unreachable after wave')
    return false
  }
  return true
}

async function main() {
  console.log(`\n🔥 TRACT heavy load — ${waves} wave(s) at ${API}\n`)
  const start = Date.now()

  for (let i = 1; i <= waves; i++) {
    const ok = await wave(i)
    if (!ok) break
    if (i < waves) await new Promise((r) => setTimeout(r, 2000))
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n────────────────────────────────')
  console.log(`Requests: ${stats.ok} ok, ${stats.err4xx} 4xx, ${stats.err5xx} 5xx, ${stats.down} down`)
  console.log(`Duration: ${elapsed}s`)

  if (stats.bugs.length > 0) {
    console.log(`\n❌ ${stats.bugs.length} issue(s) found`)
    for (const b of stats.bugs) console.log(`   • ${b.name}: ${b.detail}`)
    process.exit(1)
  }

  console.log('\n✅ Heavy load completed — no 5xx or crashes\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
