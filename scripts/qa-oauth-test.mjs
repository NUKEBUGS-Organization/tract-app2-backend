#!/usr/bin/env node
/**
 * Google OAuth "complete signup" flow — adversarial input.
 *
 * The GET /auth/google[...] handshake needs live Google credentials, so this
 * exercises the reachable half: POST /auth/google/complete, which consumes a
 * `purpose: google_signup` JWT signed with JWT_ACCESS_SECRET. We mint that
 * token locally (the secret is in .env) and hammer the endpoint.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import { api, auth, registerUser, loginUser, createRedis } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const SECRET = process.env.JWT_ACCESS_SECRET
const stamp = Date.now()
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log(`✅ ${n}`) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }
const oid = (s) => new mongoose.Types.ObjectId(String(s))

function signupToken(over = {}, opts = {}) {
  const body = {
    purpose: 'google_signup',
    googleId: `g-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
    email: `oauth_${stamp}_${Math.random().toString(36).slice(2, 7)}@test.com`,
    fullName: 'OAuth Tester',
    avatarUrl: null,
    ...over,
  }
  return jwt.sign(body, opts.secret ?? SECRET, { expiresIn: opts.expiresIn ?? '10m' })
}

const goodBody = (over = {}) => ({
  phone: `+1512${String(stamp).slice(-7)}`,
  role: 'buyer',
  dob: '1990-01-01',
  stateCode: 'TX',
  ...over,
})

async function complete(token, bodyOver = {}) {
  return api('/auth/google/complete', {
    method: 'POST',
    body: JSON.stringify({ token, ...goodBody(bodyOver) }),
  })
}

async function main() {
  if (!SECRET) { console.error('JWT_ACCESS_SECRET missing'); process.exit(1) }
  await mongoose.connect(process.env.MONGODB_URI)
  const users = mongoose.connection.db.collection('users')
  const redis = createRedis()

  // ── Happy path ──────────────────────────────────────────────────────────
  try {
    const email = `oauth_hp_${stamp}@test.com`
    const gId = `g-hp-${stamp}`
    const r = await complete(signupToken({ email, googleId: gId }), { phone: `+1512${String(stamp).slice(-7)}` })
    const d = r.body?.data ?? r.body
    if (r.status === 201 && d?.accessToken && d?.user?.email === email) {
      const u = await users.findOne({ email })
      const ok = u && u.googleId === gId && u.authProvider === 'google' && u.role === 'buyer' &&
        u.kycStatus === 'approved' && u.passwordHash
      if (ok) pass('happy path → 201, user created (google provider, kyc auto-approved, placeholder hash)')
      else fail('happy path user shape', JSON.stringify({ googleId: u?.googleId, authProvider: u?.authProvider, role: u?.role, kyc: u?.kycStatus }))
    } else {
      fail('happy path', `${r.status} ${JSON.stringify(d)?.slice(0, 200)}`)
    }
  } catch (e) { fail('happy path', e.message) }

  // ── Token integrity ─────────────────────────────────────────────────────
  const tokenCases = [
    ['expired token → 401', signupToken({}, { expiresIn: -10 }), {}, 401],
    ['wrong-secret signature → 401', signupToken({}, { secret: 'not-the-secret' }), {}, 401],
    ['wrong purpose → 401', signupToken({ purpose: 'password_reset' }), {}, 401],
    ['payload missing googleId → 401', jwt.sign({ purpose: 'google_signup', email: `x${stamp}@t.com` }, SECRET, { expiresIn: '10m' }), {}, 401],
    ['payload missing email → 401', jwt.sign({ purpose: 'google_signup', googleId: 'g-x' }, SECRET, { expiresIn: '10m' }), {}, 401],
    ['garbage token string → 401', 'not.a.jwt', {}, 401],
    ['empty token → 400/401', '', {}, [400, 401]],
  ]
  for (const [label, tok, over, want] of tokenCases) {
    try {
      const r = await complete(tok, over)
      const wants = Array.isArray(want) ? want : [want]
      if (wants.includes(r.status)) pass(label)
      else fail(label, `got ${r.status} ${JSON.stringify(r.body)?.slice(0, 140)}`)
    } catch (e) { fail(label, e.message) }
  }

  // ── Token confusion: a real access token must NOT work here ──────────────
  try {
    const u = await registerUser(redis, 'buyer', stamp, 40)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const realAccess = u.accessToken
    const r = await complete(realAccess)
    if (r.status === 401) pass('real access token rejected as signup token → 401')
    else fail('token confusion', `access token accepted at /google/complete: ${r.status}`)
  } catch (e) { fail('token confusion', e.message) }

  // ── Role / state / field validation ─────────────────────────────────────
  const fieldCases = [
    ['role=admin → 400 (rejected at DTO enum)', { role: 'admin' }, 400],
    ['role=seller → 400 (not in DTO enum)', { role: 'seller' }, 400],
    ['role=superuser → 400', { role: 'superuser' }, 400],
    ['stateCode=CA → 400', { stateCode: 'CA' }, 400],
    ['stateCode lowercase "tx" → 400', { stateCode: 'tx' }, 400],
    ['phone "abc" → 400', { phone: 'abc' }, 400],
    ['phone too short → 400', { phone: '12345' }, 400],
    ['dob not-a-date → 400', { dob: 'yesterday' }, 400],
  ]
  for (const [label, over, want] of fieldCases) {
    try {
      const r = await complete(signupToken(), over)
      if (r.status === want) pass(label)
      else fail(label, `got ${r.status} ${JSON.stringify(r.body)?.slice(0, 140)}`)
    } catch (e) { fail(label, e.message) }
  }

  // ── Age / dob sanity (expected findings) ────────────────────────────────
  try {
    const r = await complete(signupToken({ email: `oauth_future_${stamp}@test.com` }),
      { dob: '3000-01-01', phone: `+1512${String(stamp + 1).slice(-7)}` })
    if (r.status === 400) pass('dob in the future → 400')
    else fail('dob in the future', `got ${r.status} — future birthdate accepted`)
  } catch (e) { fail('dob future', e.message) }
  try {
    const r = await complete(signupToken({ email: `oauth_minor_${stamp}@test.com` }),
      { dob: '2015-06-01', phone: `+1512${String(stamp + 2).slice(-7)}` })
    if (r.status === 400) pass('under-18 dob → 400')
    else fail('under-18 dob', `got ${r.status} — a 10-year-old birthdate was accepted`)
  } catch (e) { fail('under-18 dob', e.message) }

  // ── Replay / concurrency ───────────────────────────────────────────────
  try {
    const email = `oauth_replay_${stamp}@test.com`
    const tok = signupToken({ email, googleId: `g-rep-${stamp}` })
    const r1 = await complete(tok, { phone: `+1512${String(stamp + 3).slice(-7)}` })
    const r2 = await complete(tok, { phone: `+1512${String(stamp + 4).slice(-7)}` })
    const count = await users.countDocuments({ email })
    if (r1.status === 201 && r2.status === 409 && count === 1) pass('token replay after use → 409, single user row')
    else fail('token replay', `r1=${r1.status} r2=${r2.status} rows=${count}`)
  } catch (e) { fail('token replay', e.message) }

  try {
    const email = `oauth_race_${stamp}@test.com`
    const tok = signupToken({ email, googleId: `g-race-${stamp}` })
    const [a, b] = await Promise.all([
      complete(tok, { phone: `+1512${String(stamp + 5).slice(-7)}` }),
      complete(tok, { phone: `+1512${String(stamp + 6).slice(-7)}` }),
    ])
    const codes = [a.status, b.status].sort()
    const count = await users.countDocuments({ email })
    if (codes[0] === 201 && codes[1] === 409 && count === 1) pass('concurrent same-token → 201 + 409, single user row')
    else fail('concurrent same-token', `codes=${codes.join('/')} rows=${count} (2 rows = email unique index gap)`)
  } catch (e) { fail('concurrent same-token', e.message) }

  // ── Collision with an existing password account ─────────────────────────
  try {
    const victim = await registerUser(redis, 'buyer', stamp, 50) // has email + phone + password
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const before = await users.findOne({ email: victim.email })
    const r = await complete(signupToken({ email: victim.email, googleId: `g-takeover-${stamp}` }),
      { phone: `+1512${String(stamp + 7).slice(-7)}` })
    const after = await users.findOne({ email: victim.email })
    const noSession = r.status === 409
    const untouched = String(after._id) === String(before._id) &&
      after.phone === before.phone && !after.googleId
    if (noSession && untouched) pass('email collision with password account → 409, victim account untouched (no googleId link, no session)')
    else fail('email collision / takeover', `status=${r.status} gotToken=${Boolean((r.body?.data ?? r.body)?.accessToken)} victim.googleId=${after.googleId}`)
  } catch (e) { fail('email collision', e.message) }

  // ── Phone dedup: exact match blocked; format variant? ───────────────────
  try {
    const pv = await registerUser(redis, 'wholesaler', stamp, 60)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const vic = await users.findOne({ email: pv.email })
    const rawPhone = vic.phone // e.g. +1512...
    const exact = await complete(signupToken({ email: `pd_exact_${stamp}@test.com` }), { phone: rawPhone })
    if (exact.status === 409) pass('phone dedup — exact match → 409')
    else fail('phone dedup exact', `got ${exact.status}`)

    const variant = rawPhone.startsWith('+') ? rawPhone.slice(1) : `+${rawPhone}`
    const rv = await complete(signupToken({ email: `pd_variant_${stamp}@test.com` }), { phone: variant })
    const dupCount = await users.countDocuments({ phone: { $in: [rawPhone, variant] } })
    if (rv.status === 409 && dupCount === 1) {
      pass('phone dedup — "+" / no-"+" variant also → 409')
    } else {
      fail('phone dedup variant', `variant "${variant}" got ${rv.status}; distinct rows for same number = ${dupCount} (format not normalised to E.164 before dedup)`)
    }
  } catch (e) { fail('phone dedup', e.message) }

  await redis.quit().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  const p = results.filter((r) => r.ok).length
  console.log(`\n${'─'.repeat(60)}\nPassed: ${p} | Failed: ${results.length - p} (of ${results.length})`)
  process.exit(results.length - p > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
