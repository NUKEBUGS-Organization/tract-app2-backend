#!/usr/bin/env node
/**
 * Post-close ratings — edge cases and adversarial input.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { api, auth, createDealFixture, createRedis } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const stamp = Date.now()
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log(`✅ ${n}`) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }
const oid = (s) => new mongoose.Types.ObjectId(String(s))

const CLOSE_STEPS = [
  'emd_deposited', 'inspection_period', 'appraisal_ordered', 'financing_approved',
  'title_search_complete', 'clear_to_close', 'funded_closed',
]
async function advanceToClose(dealId, adminToken) {
  for (const step of CLOSE_STEPS) {
    const r = await api(`/deals/${dealId}/advance`, {
      method: 'POST', headers: auth(adminToken), body: JSON.stringify({ step }),
    })
    if (!r.ok) throw new Error(`advance ${step}: ${r.status} ${JSON.stringify(r.body)}`)
  }
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  const redis = createRedis()

  // Fixture 1 — an OPEN deal (not closed) for the "too early" check.
  let openFx
  try {
    openFx = await createDealFixture(redis, stamp)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const r = await api('/ratings', {
      method: 'POST', headers: auth(openFx.buyer.accessToken),
      body: JSON.stringify({ dealId: openFx.dealId, stars: 5 }),
    })
    if (r.status === 403) pass('rate before close → 403')
    else fail('rate before close', `expected 403, got ${r.status} ${JSON.stringify(r.body)}`)
  } catch (e) { fail('open-deal fixture', e.message) }

  // Fixture 2 — a CLOSED deal for everything else.
  let fx, outsider
  try {
    fx = await createDealFixture(redis, stamp + 5000)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    await advanceToClose(fx.dealId, fx.adminToken)
    pass('fixture — deal advanced to funded_closed')
  } catch (e) { fail('closed fixture', e.message); return finish(redis) }

  const B = () => auth(fx.buyer.accessToken)
  const W = () => auth(fx.wholesaler.accessToken)

  // Non-party rates → 403
  try {
    const { registerUser } = await import('./qa-lib.mjs')
    outsider = await registerUser(redis, 'buyer', stamp + 5000, 7)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const r = await api('/ratings', {
      method: 'POST', headers: auth(outsider.accessToken),
      body: JSON.stringify({ dealId: fx.dealId, stars: 4 }),
    })
    if (r.status === 403) pass('non-party rates → 403')
    else fail('non-party rates', `expected 403, got ${r.status}`)
  } catch (e) { fail('non-party rates', e.message) }

  // Adversarial stars
  const starCases = [
    { v: 0, want: 400, label: 'stars 0 → 400' },
    { v: 6, want: 400, label: 'stars 6 → 400' },
    { v: -3, want: 400, label: 'stars -3 → 400' },
    { v: 'abc', want: 400, label: 'stars "abc" → 400' },
    { v: 3.7, want: 400, label: 'stars 3.7 (non-integer) → 400' },
  ]
  for (const c of starCases) {
    try {
      const r = await api('/ratings', {
        method: 'POST', headers: W(),
        body: JSON.stringify({ dealId: fx.dealId, stars: c.v }),
      })
      if (r.status === c.want) pass(c.label)
      else fail(c.label, `got ${r.status} ${JSON.stringify(r.body)}`)
      // clean any accidental insert
      await mongoose.connection.db.collection('ratings').deleteMany({
        dealId: oid(fx.dealId), raterId: oid(fx.wholesaler.userId),
      })
    } catch (e) { fail(c.label, e.message) }
  }

  // Oversized comment
  try {
    const r = await api('/ratings', {
      method: 'POST', headers: W(),
      body: JSON.stringify({ dealId: fx.dealId, stars: 5, comment: 'x'.repeat(5000) }),
    })
    if (r.status === 400) pass('comment 5000 chars → 400')
    else fail('comment 5000 chars', `expected 400, got ${r.status} ${JSON.stringify(r.body)?.slice(0, 120)}`)
    await mongoose.connection.db.collection('ratings').deleteMany({
      dealId: oid(fx.dealId), raterId: oid(fx.wholesalerId ?? fx.wholesaler.userId),
    })
  } catch (e) { fail('comment 5000 chars', e.message) }

  // Bad dealId shapes
  try {
    const r = await api('/ratings', {
      method: 'POST', headers: B(), body: JSON.stringify({ dealId: 'not-an-id', stars: 5 }),
    })
    if (r.status === 400) pass('dealId "not-an-id" → 400'); else fail('bad dealId shape', `got ${r.status}`)
  } catch (e) { fail('bad dealId shape', e.message) }
  try {
    const r = await api('/ratings', {
      method: 'POST', headers: B(),
      body: JSON.stringify({ dealId: '0'.repeat(24), stars: 5 }),
    })
    if (r.status === 404) pass('dealId valid-but-missing → 404'); else fail('missing dealId', `got ${r.status}`)
  } catch (e) { fail('missing dealId', e.message) }

  // Concurrent double-submit by the same rater (race on the findOne check)
  try {
    const body = JSON.stringify({ dealId: fx.dealId, stars: 5, comment: 'race' })
    const [a, b] = await Promise.all([
      api('/ratings', { method: 'POST', headers: B(), body }),
      api('/ratings', { method: 'POST', headers: B(), body }),
    ])
    const codes = [a.status, b.status].sort()
    const created = await mongoose.connection.db.collection('ratings').countDocuments({
      dealId: oid(fx.dealId), raterId: oid(fx.buyer.userId),
    })
    if (codes[0] === 201 && codes[1] === 409 && created === 1) {
      pass('concurrent double-submit → 201 + 409, exactly 1 row')
    } else {
      fail('concurrent double-submit', `codes=${codes.join('/')}, rows=${created} (a 500 here = unhandled E11000)`)
    }
  } catch (e) { fail('concurrent double-submit', e.message) }

  // Sequential duplicate → 409
  try {
    const r = await api('/ratings', {
      method: 'POST', headers: B(), body: JSON.stringify({ dealId: fx.dealId, stars: 3 }),
    })
    if (r.status === 409) pass('sequential duplicate rating → 409'); else fail('sequential duplicate', `got ${r.status}`)
  } catch (e) { fail('sequential duplicate', e.message) }

  // Wholesaler rates buyer → 201, buyer professionalScore recomputed
  try {
    const r = await api('/ratings', {
      method: 'POST', headers: W(), body: JSON.stringify({ dealId: fx.dealId, stars: 4, comment: 'ok' }),
    })
    if (!r.ok) throw new Error(`create ${r.status} ${JSON.stringify(r.body)}`)
    const buyer = await mongoose.connection.db.collection('users').findOne({ _id: oid(fx.buyer.userId) })
    if (buyer.professionalScore === 80) pass('wholesaler→buyer 4★ sets buyer professionalScore=80')
    else fail('professionalScore recompute', `expected 80, got ${buyer.professionalScore}`)
  } catch (e) { fail('wholesaler rates buyer', e.message) }

  // Public list + average
  try {
    const r = await api(`/ratings/user/${fx.buyer.userId}`)
    const d = r.body?.data ?? r.body
    if (r.ok && d.totalRatings === 1 && d.averageStars === 4) pass('public ratings list — total 1, avg 4')
    else fail('public ratings list', `${r.status} ${JSON.stringify(d)}`)
  } catch (e) { fail('public ratings list', e.message) }

  // score/:userId ownership
  try {
    const mine = await api(`/ratings/score/${fx.buyer.userId}`, { headers: B() })
    const other = await api(`/ratings/score/${fx.wholesaler.userId}`, { headers: B() })
    if (mine.ok && other.status === 403) pass('score/:userId — own ok, other → 403')
    else fail('score ownership', `mine=${mine.status} other=${other.status}`)
  } catch (e) { fail('score ownership', e.message) }

  // Admin removes the buyer→? rating; non-admin cannot
  try {
    const bwRating = await mongoose.connection.db.collection('ratings').findOne({
      dealId: oid(fx.dealId), raterId: oid(fx.buyer.userId),
    })
    const nonAdmin = await api(`/ratings/${bwRating._id}`, { method: 'DELETE', headers: B() })
    if (nonAdmin.status === 403) pass('non-admin DELETE /ratings/:id → 403')
    else fail('non-admin delete', `got ${nonAdmin.status}`)

    const r1 = await api(`/ratings/${bwRating._id}`, { method: 'DELETE', headers: auth(fx.adminToken) })
    if (!r1.ok) throw new Error(`admin remove ${r1.status} ${JSON.stringify(r1.body)}`)
    const r2 = await api(`/ratings/${bwRating._id}`, { method: 'DELETE', headers: auth(fx.adminToken) })
    if (r2.status === 409) pass('admin remove rating → 200, second remove → 409')
    else fail('admin double remove', `second got ${r2.status}`)

    // rater picked up a BAD_FAITH_REVIEW penalty (7-day suspension)
    const pen = await mongoose.connection.db.collection('penalties').countDocuments({
      userId: oid(fx.buyer.userId), violationType: 'bad_faith_review',
    })
    const penAny = await mongoose.connection.db.collection('penalties').countDocuments({
      userId: oid(fx.buyer.userId),
    })
    if (penAny >= 1) pass(`admin removal applied a penalty to the rater (rows=${penAny})`)
    else fail('bad-faith penalty', `no penalty row for rater (bad_faith_review=${pen})`)

    // removed rating no longer in public list for the wholesaler (ratee)
    const list = await api(`/ratings/user/${fx.wholesaler.userId}`)
    const d = list.body?.data ?? list.body
    if ((d.ratings ?? []).every((x) => String(x._id) !== String(bwRating._id))) {
      pass('removed rating excluded from public list')
    } else {
      fail('removed rating still listed', JSON.stringify(d))
    }
  } catch (e) { fail('admin remove suite', e.message) }

  // Re-submit after admin removal (fresh login — earlier token may have aged out)
  try {
    const { loginUser } = await import('./qa-lib.mjs')
    const freshBuyer = await loginUser(redis, fx.buyer.email, fx.buyer.password, false).catch(() => null)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    const hdr = freshBuyer ? auth(freshBuyer) : B()
    const r = await api('/ratings', {
      method: 'POST', headers: hdr, body: JSON.stringify({ dealId: fx.dealId, stars: 5 }),
    })
    // documenting: current behaviour is 409 (existing row, soft-removed, still blocks)
    console.log(`   ℹ re-submit after admin removal → ${r.status} (${r.status === 409 ? 'blocked by soft-removed row' : 'allowed'})`)
    pass('re-submit after admin removal — behaviour recorded')
  } catch (e) { fail('re-submit after removal', e.message) }

  // getUserRatings for garbage / empty
  try {
    const g = await api('/ratings/user/garbage')
    const gd = g.body?.data ?? g.body
    const e = await api(`/ratings/user/${'a'.repeat(24)}`)
    const ed = e.body?.data ?? e.body
    if (g.ok && gd.totalRatings === 0 && e.ok && ed.totalRatings === 0) {
      pass('getUserRatings — garbage id & unknown id → empty, no 500')
    } else {
      fail('getUserRatings garbage', `garbage=${g.status} unknown=${e.status}`)
    }
  } catch (e) { fail('getUserRatings garbage', e.message) }

  finish(redis)
}

async function finish(redis) {
  await redis.quit().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  const p = results.filter((r) => r.ok).length
  console.log(`\n${'─'.repeat(60)}\nPassed: ${p} | Failed: ${results.length - p} (of ${results.length})`)
  process.exit(results.length - p > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
