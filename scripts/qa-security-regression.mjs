#!/usr/bin/env node
/**
 * Regression tests for security fixes (session revoke, WS auth, OTP gate).
 * Usage: node scripts/qa-security-regression.mjs
 */
import { io } from 'socket.io-client'
import {
  API,
  API_ROOT,
  api,
  auth,
  createDealFixture,
  createRedis,
  registerUser,
} from './qa-lib.mjs'

const stamp = Date.now()
const results = []

function pass(name) {
  results.push({ name, ok: true })
  console.log(`✅ ${name}`)
}

function fail(name, err) {
  const msg = err instanceof Error ? err.message : String(err)
  results.push({ name, ok: false, error: msg })
  console.error(`❌ ${name}: ${msg}`)
}

function joinDealRoom(token, dealId) {
  return new Promise((resolve, reject) => {
    const socket = io(API_ROOT, {
      auth: { token },
      transports: ['websocket'],
      timeout: 10_000,
    })
    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error('timeout'))
    }, 12_000)
    socket.on('connect', () => {
      setTimeout(() => {
        socket.emit('deal:join', { dealId }, (ack) => {
          clearTimeout(timer)
          socket.disconnect()
          resolve(ack)
        })
      }, 500)
    })
    socket.on('connect_error', (err) => {
      clearTimeout(timer)
      socket.disconnect()
      reject(err)
    })
  })
}

async function main() {
  console.log(`\n🛡️  TRACT security regression — ${API}\n`)
  const redis = createRedis()

  // Logout revokes access token session
  try {
    const user = await registerUser(redis, 'buyer', stamp, 50)
    const token = user.accessToken
    const logout = await api('/auth/logout', {
      method: 'POST',
      headers: auth(token),
    })
    if (!logout.ok) throw new Error(`logout ${logout.status}`)
    const me = await api('/auth/me', { headers: auth(token) })
    if (me.status === 401) pass('Logout revokes server session')
    else fail('Logout revokes server session', `expected 401, got ${me.status}`)
  } catch (e) {
    fail('Logout revokes server session', e)
  }

  // Registration still requires OTP verify
  try {
    const email = `reg_skip_${stamp}@test.com`
    const res = await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: 'Skip',
        email,
        phone: `+1${String(stamp + 51).slice(-10).padStart(10, '0')}`,
        password: 'Password1',
        role: 'buyer',
        dob: '1990-01-01',
        stateCode: 'TX',
      }),
    })
    if (res.status === 403 || res.status === 400) pass('Registration requires OTP verify')
    else fail('Registration requires OTP verify', `status ${res.status}`)
  } catch (e) {
    fail('Registration requires OTP verify', e)
  }

  // PDF IDOR still blocked
  try {
    const outsider = await registerUser(redis, 'buyer', stamp, 52)
    let fixture
    try {
      fixture = await createDealFixture(redis, stamp + 1000)
    } catch {
      fixture = null
    }
    if (!fixture) {
      console.log('⏭️  PDF IDOR regression (skipped: no deal fixture)')
    } else {
      const res = await api(`/pdf/emd/${fixture.dealId}`, {
        headers: auth(outsider.accessToken),
      })
      if (res.status === 403 || res.status === 404) pass('PDF IDOR still blocked')
      else fail('PDF IDOR still blocked', `status ${res.status}`)
    }
  } catch (e) {
    fail('PDF IDOR still blocked', e)
  }

  // WebSocket foreign deal join blocked
  try {
    const fixture = await createDealFixture(redis, stamp + 2000)
    const outsider = await registerUser(redis, 'buyer', stamp, 53)
    const ack = await joinDealRoom(outsider.accessToken, fixture.dealId)
    if (ack?.error === 'forbidden') pass('WebSocket foreign deal join blocked')
    else fail('WebSocket foreign deal join blocked', JSON.stringify(ack))
  } catch (e) {
    fail('WebSocket foreign deal join blocked', e)
  }

  // Public listing: owner sees cancelled, anonymous does not
  try {
    const wholesaler = await registerUser(redis, 'wholesaler', stamp, 54)
    const adminToken = await (async () => {
      const { loginUser } = await import('./qa-lib.mjs')
      return loginUser(redis, 'wasifzahoor296@gmail.com', 'admin1234!', false)
    })()

    let res = await api('/listings', {
      method: 'POST',
      headers: auth(wholesaler.accessToken),
      body: JSON.stringify({ dealType: 'fix_flip', marketStatus: 'off_market' }),
    })
    const listingId = res.body.data._id
    res = await api(`/listings/${listingId}`, {
      method: 'PATCH',
      headers: auth(wholesaler.accessToken),
      body: JSON.stringify({
        propertyAddress: '1 Gate Test',
        city: 'Dallas',
        stateCode: 'TX',
        zipCode: '75201',
        arv: 400000,
        rehabTotal: 60000,
        purchasePrice: 280000,
        assignmentFeeLow: 12000,
        assignmentFeeHigh: 18000,
        estimatedHoldingCosts: 6000,
      }),
    })
    if (!res.ok) throw new Error(`patch ${res.status}`)

    res = await api(`/listings/${listingId}/publish`, {
      method: 'POST',
      headers: auth(wholesaler.accessToken),
    })
    if (!res.ok) throw new Error(`publish ${res.status} ${JSON.stringify(res.body)}`)

    res = await api(`/admin/listings/${listingId}/review`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ action: 'reject', reason: 'security regression' }),
    })
    if (!res.ok) throw new Error(`reject ${res.status} ${JSON.stringify(res.body)}`)

    const anon = await api(`/listings/${listingId}`)
    const owner = await api(`/listings/${listingId}`, { headers: auth(wholesaler.accessToken) })
    if (anon.status === 404 && owner.body.data?.status === 'cancelled') {
      pass('Listing visibility gate — draft/cancelled hidden from public')
    } else {
      fail(
        'Listing visibility gate — draft/cancelled hidden from public',
        `anon=${anon.status} owner=${owner.body.data?.status}`,
      )
    }
  } catch (e) {
    fail('Listing visibility gate — draft/cancelled hidden from public', e)
  }

  await redis.quit().catch(() => undefined)

  console.log('\n────────────────────────────────')
  const bad = results.filter((r) => !r.ok)
  if (bad.length === 0) {
    console.log(`All ${results.length} regression tests passed.\n`)
    process.exit(0)
  }
  console.log(`${bad.length}/${results.length} failed\n`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
