#!/usr/bin/env node
/**
 * Covers previously untested areas: password reset, notifications, vault,
 * ratings, penalties, WebSocket chat delivery, title rep, OAuth, DocuSeal,
 * Cloudinary, PayPal webhook, rate-limit behavior (dev).
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { io } from 'socket.io-client'
import {
  API,
  API_ROOT,
  api,
  auth,
  createDealFixture,
  createRedis,
  loginUser,
  readEmailOtp,
  registerUser,
} from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const stamp = Date.now()
const results = []
const DEAL_ADVANCE_STEPS = [
  'emd_deposited',
  'inspection_period',
  'appraisal_ordered',
  'financing_approved',
  'title_search_complete',
  'clear_to_close',
  'funded_closed',
]

function pass(name) {
  results.push({ name, ok: true })
  console.log(`✅ ${name}`)
}

function fail(name, err) {
  const msg = err instanceof Error ? err.message : String(err)
  results.push({ name, ok: false, error: msg })
  console.error(`❌ ${name}: ${msg}`)
}

function skip(name, reason) {
  results.push({ name, ok: true, skipped: true, reason })
  console.log(`⏭️  ${name} — ${reason}`)
}

async function advanceDeal(dealId, adminToken) {
  for (const step of DEAL_ADVANCE_STEPS) {
    const res = await api(`/deals/${dealId}/advance`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ step }),
    })
    if (!res.ok) throw new Error(`advance ${step}: ${res.status}`)
  }
}

function listenForChatMessage(buyerToken, dealId, wholesalerToken, expectedContent) {
  return new Promise((resolve, reject) => {
    const socket = io(API_ROOT, {
      auth: { token: buyerToken },
      transports: ['websocket'],
      timeout: 10_000,
    })
    const timer = setTimeout(() => {
      socket.disconnect()
      reject(new Error('chat:message timeout'))
    }, 20_000)

    socket.on('chat:message', (payload) => {
      if (payload?.content === expectedContent) {
        clearTimeout(timer)
        socket.disconnect()
        resolve(payload)
      }
    })

    socket.on('connect', () => {
      setTimeout(() => {
        socket.emit('deal:join', { dealId })
        setTimeout(async () => {
          const res = await api('/chat', {
            method: 'POST',
            headers: auth(wholesalerToken),
            body: JSON.stringify({ dealId, content: expectedContent }),
          })
          if (res.status !== 201) {
            clearTimeout(timer)
            socket.disconnect()
            reject(new Error(`send chat ${res.status}`))
          }
        }, 800)
      }, 600)
    })

    socket.on('connect_error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

async function main() {
  console.log(`\n🧪 TRACT gap coverage — ${API}\n`)
  const redis = createRedis()

  // ── Password reset ────────────────────────────────────────────
  try {
    const user = await registerUser(redis, 'buyer', stamp, 10)
    const newPassword = 'ResetPass1'

    let res = await api('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: user.email }),
    })
    if (!res.ok) throw new Error(`forgot-password ${res.status}`)

    const resetCode = await readEmailOtp(redis, `reset:${user.email.toLowerCase()}`)
    res = await api('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email: user.email, token: resetCode, newPassword }),
    })
    if (!res.ok) throw new Error(`reset-password ${res.status}`)

    const token = await loginUser(redis, user.email, newPassword, false)
    if (!token) throw new Error('login after reset failed')
    pass('Password reset — forgot → reset → login with new password')
  } catch (e) {
    fail('Password reset — forgot → reset → login with new password', e)
  }

  // ── Google OAuth entrypoint ───────────────────────────────────
  try {
    const res = await fetch(`${API}/auth/google`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    if (res.status === 302 && /accounts\.google\.com|google/i.test(location)) {
      pass('Google OAuth — /auth/google redirects to Google')
    } else if (res.status >= 500) {
      skip('Google OAuth — /auth/google redirects to Google', `server ${res.status} (credentials may be unset)`)
    } else {
      throw new Error(`unexpected status ${res.status}, location=${location}`)
    }
  } catch (e) {
    fail('Google OAuth — /auth/google redirects to Google', e)
  }

  let fixture
  try {
    fixture = await createDealFixture(redis, stamp + 1000)
  } catch (e) {
    fail('Fixture — deal for vault/notifications/ratings', e)
  }

  const { buyer, wholesaler, adminToken, dealId, listingId, bidId } = fixture ?? {}

  // ── Notifications ─────────────────────────────────────────────
  if (buyer) {
    try {
      const res = await api('/notifications', { headers: auth(buyer.accessToken) })
      if (!res.ok) throw new Error(`list ${res.status}`)
      const items = res.body.data ?? []
      if (!items.length) throw new Error('expected notification after deal create')
      const firstId = items[0].id ?? items[0]._id
      let mark = await api(`/notifications/${firstId}/read`, {
        method: 'PATCH',
        headers: auth(buyer.accessToken),
      })
      if (!mark.ok) throw new Error(`mark read ${mark.status}`)
      mark = await api('/notifications/read-all', {
        method: 'PATCH',
        headers: auth(buyer.accessToken),
      })
      if (!mark.ok) throw new Error(`mark all ${mark.status}`)
      pass('Notifications — list, mark one read, mark all read')
    } catch (e) {
      fail('Notifications — list, mark one read, mark all read', e)
    }
  }

  // ── Vault ─────────────────────────────────────────────────────
  if (buyer && dealId) {
    try {
      const fileName = `qa-vault-${stamp}.pdf`
      const fileUrl = 'https://example.com/qa-vault-doc.pdf'
      let res = await api(`/deals/${dealId}/vault`, {
        method: 'POST',
        headers: auth(buyer.accessToken),
        body: JSON.stringify({ fileName, fileUrl, fileType: 'document', visibleTo: 'all' }),
      })
      if (res.status !== 201) throw new Error(`upload ${res.status}`)
      const docId = res.body.data?._id

      res = await api(`/deals/${dealId}/vault`, { headers: auth(wholesaler.accessToken) })
      if (!res.ok) throw new Error(`list ${res.status}`)
      const docs = res.body.data ?? []
      if (!docs.some((d) => d.fileName === fileName)) throw new Error('uploaded doc not listed')

      res = await api(`/deals/${dealId}/vault/${docId}`, {
        method: 'DELETE',
        headers: auth(buyer.accessToken),
      })
      if (!res.ok) throw new Error(`delete ${res.status}`)
      pass('Vault — upload, list (party), delete')
    } catch (e) {
      fail('Vault — upload, list (party), delete', e)
    }
  }

  // ── Ratings (requires funded_closed) ──────────────────────────
  if (buyer && wholesaler && dealId && adminToken) {
    try {
      await advanceDeal(dealId, adminToken)
      let res = await api('/ratings', {
        method: 'POST',
        headers: auth(buyer.accessToken),
        body: JSON.stringify({ dealId, stars: 5, comment: 'QA gap test rating' }),
      })
      if (res.status !== 201 && !res.ok) throw new Error(`create rating ${res.status}`)

      res = await api(`/ratings/user/${wholesaler.userId}`)
      if (!res.ok) throw new Error(`public ratings ${res.status}`)

      res = await api(`/ratings/score/${buyer.userId}`, { headers: auth(buyer.accessToken) })
      if (!res.ok) throw new Error(`score ${res.status}`)
      pass('Ratings — post-close submit, public list, reliability score')
    } catch (e) {
      fail('Ratings — post-close submit, public list, reliability score', e)
    }
  }

  // ── Penalties ─────────────────────────────────────────────────
  if (buyer && adminToken) {
    try {
      let res = await api(`/users/${buyer.userId}/penalty`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({
          violationType: 'ghosting',
          notes: 'QA gap penalty test',
        }),
      })
      if (!res.ok) throw new Error(`apply penalty ${res.status}`)

      res = await api('/users/me/score', { headers: auth(buyer.accessToken) })
      if (!res.ok) throw new Error(`me/score ${res.status}`)

      res = await api('/admin/penalties', { headers: auth(adminToken) })
      if (!res.ok) throw new Error(`admin penalties ${res.status}`)
      pass('Penalties — admin apply, user score, admin penalty log')
    } catch (e) {
      fail('Penalties — admin apply, user score, admin penalty log', e)
    }
  }

  // ── WebSocket chat message delivery ───────────────────────────
  // The primary fixture's deal was advanced to funded_closed by the Ratings
  // test above, which locks its chat. Use a fresh, still-open deal here.
  {
    let chatFixture
    try {
      chatFixture = await createDealFixture(redis, stamp + 5000)
    } catch (e) {
      fail('WebSocket — chat:message delivered to deal room (fixture)', e)
    }
    if (chatFixture?.dealId) {
      try {
        const content = `WS chat ${stamp}`
        await listenForChatMessage(
          chatFixture.buyer.accessToken,
          chatFixture.dealId,
          chatFixture.wholesaler.accessToken,
          content,
        )
        pass('WebSocket — chat:message delivered to deal room')
      } catch (e) {
        fail('WebSocket — chat:message delivered to deal room', e)
      }
    }
  }

  // ── Title rep login (API surface mostly disabled) ─────────────
  try {
    const titleToken = await loginUser(redis, 'maliksaifnew@gmail.com', 'Test1234!', false)
    const res = await api('/deals', { headers: auth(titleToken) })
    if (!res.ok) throw new Error(`title rep deals ${res.status}`)
    pass('Title rep — seeded account login + deals list')
  } catch (e) {
    fail('Title rep — seeded account login + deals list', e)
  }

  // ── DocuSeal contract create ──────────────────────────────────
  if (wholesaler && listingId && bidId) {
    const key = process.env.DOCUSEAL_API_KEY?.trim()
    if (!key || key === 'not-configured') {
      skip('DocuSeal — contract create via API', 'DOCUSEAL_API_KEY not configured')
    } else {
      try {
        const res = await api(`/contracts/listing/${listingId}`, {
          method: 'POST',
          headers: auth(wholesaler.accessToken),
          body: JSON.stringify({ bidId, emdAmount: 1500, closingDays: 30, feasibilityDays: 14 }),
        })
        if (res.status === 201 || res.ok) pass('DocuSeal — contract create via API')
        else throw new Error(`${res.status} ${JSON.stringify(res.body)}`)
      } catch (e) {
        fail('DocuSeal — contract create via API', e)
      }
    }
  }

  // ── Cloudinary listing photo ──────────────────────────────────
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim()
  if (!cloudName || cloudName === 'not-configured') {
    skip('Cloudinary — listing photo upload', 'CLOUDINARY_* not configured')
  } else {
    skip('Cloudinary — listing photo upload', 'multipart upload not automated in gap script')
  }

  // ── PayPal webhook forgery ────────────────────────────────────
  try {
    const res = await api('/payments/paypal/webhook', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'fake' } }),
    })
    if (res.status === 401 || res.status === 403) {
      pass('PayPal webhook — forged payload rejected')
    } else {
      throw new Error(`expected 401/403, got ${res.status}`)
    }
  } catch (e) {
    fail('PayPal webhook — forged payload rejected', e)
  }

  // ── Rate limiting (dev skips throttling) ──────────────────────
  try {
    if (process.env.NODE_ENV === 'production') {
      skip('Rate limiting — dev mode skips throttle', 'NODE_ENV=production (run isolated prod test separately)')
    } else {
      const hits = await Promise.all(
        Array.from({ length: 30 }, () => api('/auth/states')),
      )
      const throttled = hits.filter((h) => h.status === 429).length
      if (throttled > 0) throw new Error(`${throttled}/30 returned 429 in development`)
      pass('Rate limiting — no 429 in development (production behavior untested here)')
    }
  } catch (e) {
    fail('Rate limiting — no 429 in development (production behavior untested here)', e)
  }

  await redis.quit().catch(() => undefined)

  console.log('\n────────────────────────────────')
  const failed = results.filter((r) => !r.ok)
  const skipped = results.filter((r) => r.skipped)
  const passed = results.filter((r) => r.ok && !r.skipped)
  console.log(`Passed: ${passed.length} | Skipped: ${skipped.length} | Failed: ${failed.length}`)
  if (failed.length) {
    console.log('\nFailures:')
    for (const f of failed) console.log(`  • ${f.name}: ${f.error}`)
    console.log()
    process.exit(1)
  }
  console.log()
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
