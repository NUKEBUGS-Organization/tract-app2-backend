#!/usr/bin/env node
/**
 * Extreme crash hunt — max concurrency, socket floods, payload bombs, sustained churn.
 * Usage: node scripts/qa-nuke-test.mjs
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { io } from 'socket.io-client'
import Redis from 'ioredis'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const API_ROOT = API.replace(/\/api\/v1$/, '')
const TEST_OTP = process.env.TEST_OTP_CODE ?? '123456'
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
      signal: AbortSignal.timeout(30_000),
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
    return { status: res.status, body, ok: res.ok, down: false }
  } catch (err) {
    stats.down++
    return { status: 0, body: null, ok: false, down: true, error: err instanceof Error ? err.message : String(err) }
  }
}

async function health() {
  const r = await api('/auth/states')
  return r.ok && !r.down
}

async function registerFast(redis, offset) {
  const email = `nuke_${stamp}_${offset}@test.com`
  const phone = `+1${String(stamp + offset).slice(-10).padStart(10, '0')}`
  await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  const otp = await redis.get(`otp:email:${email}`)
  if (!otp) return null
  await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, emailOtp: otp }) })
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `Nuke ${offset}`,
      email,
      phone,
      password: 'Password1',
      role: offset % 2 ? 'buyer' : 'wholesaler',
      dob: '1990-01-01',
      stateCode: 'TX',
    }),
  })
  return reg.body?.data?.accessToken ?? null
}

function socketStorm(token, count) {
  const sockets = []
  return new Promise((resolve) => {
    let connected = 0
    let errors = 0
    for (let i = 0; i < count; i++) {
      const s = io(API_ROOT, {
        auth: { token },
        transports: ['websocket'],
        timeout: 8_000,
        reconnection: false,
      })
      sockets.push(s)
      s.on('connect', () => {
        connected++
        if (connected + errors >= count) finish()
      })
      s.on('connect_error', () => {
        errors++
        if (connected + errors >= count) finish()
      })
    }
    const timer = setTimeout(finish, 12_000)
    function finish() {
      clearTimeout(timer)
      for (const s of sockets) s.disconnect()
      resolve({ connected, errors })
    }
  })
}

async function phase(name, fn) {
  console.log(`\n💣 ${name}`)
  if (!(await health())) {
    bug('server down', `before ${name}`)
    return false
  }
  await fn()
  const alive = await health()
  if (!alive) {
    bug('server down', `after ${name}`)
    return false
  }
  return true
}

async function main() {
  console.log(`\n☢️  TRACT NUKE stress — ${API}\n`)
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
  const start = Date.now()

  // Phase 1: Mega flood — 1500 concurrent reads
  await phase('1500 concurrent GET /auth/states', async () => {
    const batch = await Promise.all(Array.from({ length: 1500 }, () => api('/auth/states')))
    const f5 = batch.filter((r) => r.status >= 500).length
    const down = batch.filter((r) => r.down).length
    console.log(`   ${batch.length - f5 - down} ok, ${f5} 5xx, ${down} down`)
    if (f5 > 0) bug('mega flood states', `${f5}/1500 returned 5xx`)
    if (down > 50) bug('mega flood states', `${down} connection failures`)
  })

  // Phase 2: Mixed endpoint storm — 800 parallel mixed routes
  await phase('800 mixed-endpoint storm', async () => {
    const paths = [
      () => api('/auth/states'),
      () => api('/listings'),
      () => api('/auth/login', { method: 'POST', body: '{}' }),
      () => api('/deals/000000000000000000000000'),
      () => api('/users/me', { headers: { Authorization: 'Bearer x.y.z' } }),
      () => api('/notifications', { headers: { Authorization: 'Bearer invalid' } }),
      () => api('/admin/dashboard', { headers: { Authorization: 'Bearer invalid' } }),
      () => api('/chat/not-a-deal-id'),
    ]
    const batch = await Promise.all(
      Array.from({ length: 800 }, (_, i) => paths[i % paths.length]()),
    )
    const f5 = batch.filter((r) => r.status >= 500).length
    console.log(`   ${f5} 5xx of 800`)
    if (f5 > 0) bug('mixed storm', `${f5}/800 returned 5xx`)
  })

  // Phase 3: 40 parallel full registration storms (Resend may fail — should not 500)
  await phase('40 parallel registration storms', async () => {
    const regs = await Promise.all(Array.from({ length: 40 }, (_, i) => registerFast(redis, i)))
    const ok = regs.filter(Boolean).length
    console.log(`   ${ok}/40 got tokens`)
  })

  // Phase 4: OTP send spam — 100 rapid send-otp
  await phase('100 rapid send-otp', async () => {
    const batch = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        api('/auth/send-otp', {
          method: 'POST',
          body: JSON.stringify({ email: `otp_spam_${stamp}_${i}@test.com` }),
        }),
      ),
    )
    const f5 = batch.filter((r) => r.status >= 500).length
    console.log(`   ${f5} 5xx`)
    if (f5 > 0) bug('otp spam', `${f5}/100 returned 5xx`)
  })

  // Phase 5: Payload bombs
  await phase('payload bombs (10MB JSON, deep nest, prototype)', async () => {
    const big = JSON.stringify({ email: 'a@b.com', data: 'x'.repeat(10 * 1024 * 1024) })
    const r1 = await api('/auth/login', { method: 'POST', body: big })
    if (r1.status !== 413 && r1.status !== 400) {
      bug('10MB body', `login returned ${r1.status} (expected 413)`)
    }

    const deep = { a: {} }
    let cur = deep
    for (let i = 0; i < 500; i++) {
      cur.a = {}
      cur = cur.a
    }
    const r2 = await api('/auth/register', { method: 'POST', body: JSON.stringify(deep) })
    if (r2.status === 500) bug('deep nest', 'register returned 500')

    const r3 = await api('/auth/login', {
      method: 'POST',
      body: '{"email":"a@b.com","password":"x","__proto__":{"isAdmin":true}}',
    })
    if (r3.status === 500) bug('proto pollution', 'login returned 500')
  })

  // Phase 6: Realtor login churn — 50 parallel
  await phase('50 parallel realtor login cycles', async () => {
    const cycles = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const login = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email: 'qaiserwaheed00@gmail.com', password: 'Test1234!' }),
        })
        if (!login.ok) return login
        return api('/auth/verify-login-otp', {
          method: 'POST',
          body: JSON.stringify({ email: 'qaiserwaheed00@gmail.com', otp: TEST_OTP }),
        })
      }),
    )
    const f5 = cycles.filter((r) => r.status >= 500).length
    const ok = cycles.filter((r) => r.ok).length
    console.log(`   ${ok}/50 ok, ${f5} 5xx`)
    if (f5 > 0) bug('login churn', `${f5}/50 returned 5xx`)
  })

  // Phase 7: WebSocket connection storm
  const token = await (async () => {
    const login = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'qaiserwaheed00@gmail.com', password: 'Test1234!' }),
    })
    if (!login.ok) return null
    const v = await api('/auth/verify-login-otp', {
      method: 'POST',
      body: JSON.stringify({ email: 'qaiserwaheed00@gmail.com', otp: TEST_OTP }),
    })
    return v.body?.data?.accessToken ?? null
  })()

  if (token) {
    await phase('80 concurrent WebSocket connections', async () => {
      const { connected, errors } = await socketStorm(token, 80)
      console.log(`   ${connected} connected, ${errors} errors`)
      if (connected === 0 && errors >= 80) bug('socket storm', 'all 80 connections failed')
    })

    await phase('rapid join/leave deal rooms (invalid ids)', async () => {
      const sockets = []
      for (let i = 0; i < 30; i++) {
        const s = io(API_ROOT, { auth: { token }, transports: ['websocket'], reconnection: false })
        sockets.push(s)
      }
      await new Promise((r) => setTimeout(r, 1000))
      await Promise.all(
        sockets.map(
          (s) =>
            new Promise((res) => {
              if (!s.connected) return res(undefined)
              s.emit('deal:join', { dealId: '000000000000000000000001' })
              s.emit('listing:join', { listingId: '000000000000000000000002' })
              s.emit('room:leave', { room: 'deal:fake' })
              setTimeout(res, 200)
            }),
        ),
      )
      for (const s of sockets) s.disconnect()
    })
  }

  // Phase 8: Sustained hammer — 3 x 500 requests back-to-back
  for (let round = 1; round <= 3; round++) {
    await phase(`sustained hammer round ${round}/3 (500 req)`, async () => {
      const batch = await Promise.all(
        Array.from({ length: 500 }, (_, i) =>
          i % 3 === 0 ? api('/listings') : i % 3 === 1 ? api('/auth/states') : api('/admin/dashboard', { headers: { Authorization: 'Bearer bad' } }),
        ),
      )
      const f5 = batch.filter((r) => r.status >= 500).length
      console.log(`   ${f5} 5xx`)
      if (f5 > 0) bug(`sustained r${round}`, `${f5}/500 returned 5xx`)
    })
  }

  // Phase 9: Mongo ObjectId edge cases — 200 parallel
  await phase('200 parallel invalid ObjectId lookups', async () => {
    const ids = [
      'not-valid',
      '000000000000000000000000',
      'ffffffffffffffffffffffff',
      '../../etc/passwd',
      '%00%00%00%00%00%00%00%00%00%00%00%00',
    ]
    const batch = await Promise.all(
      Array.from({ length: 200 }, (_, i) => api(`/listings/${ids[i % ids.length]}`)),
    )
    const f5 = batch.filter((r) => r.status >= 500).length
    if (f5 > 0) bug('objectid fuzz', `${f5}/200 returned 5xx`)
  })

  // Phase 10: Parallel logout storms (invalid tokens)
  await phase('100 parallel logout with garbage tokens', async () => {
    const batch = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        api('/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer garbage.token.${i}` },
        }),
      ),
    )
    const f5 = batch.filter((r) => r.status >= 500).length
    if (f5 > 0) bug('logout spam', `${f5}/100 returned 5xx`)
  })

  await redis.quit().catch(() => undefined)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log('\n════════════════════════════════')
  console.log(`Requests: ${stats.ok} ok | ${stats.err4xx} 4xx | ${stats.err5xx} 5xx | ${stats.down} down`)
  console.log(`Duration: ${elapsed}s`)

  const alive = await health()
  if (!alive) {
    console.log('\n💥 SERVER CRASHED OR UNREACHABLE AFTER NUKE\n')
    process.exit(1)
  }

  if (stats.bugs.length) {
    console.log(`\n❌ ${stats.bugs.length} issue(s):`)
    for (const b of stats.bugs) console.log(`   • ${b.name}: ${b.detail}`)
    process.exit(1)
  }

  console.log('\n✅ Server survived nuke test\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
