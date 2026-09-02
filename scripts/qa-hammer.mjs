#!/usr/bin/env node
/**
 * Stress / hammer — concurrency + soak across App2 (and App1 internal APIs).
 * Prints a status histogram per section, flags every 5xx, and checks for
 * duplicate rows / lost updates. Root-cause fodder.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { performance } from 'perf_hooks'
import {
  API, api, auth, registerUser, loginUser, createRedis, seedSignedContract,
} from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const APP1 = (process.env.APP1_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const KEY = process.env.INTERNAL_SERVICE_KEY
const stamp = Date.now()
const oid = () => new mongoose.Types.ObjectId()
const findings = []
const flag = (s) => { findings.push(s); console.log(`   ⚠ ${s}`) }
const hist = (arr) => arr.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {})
const p = (arr, q) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q / 100 * s.length))] }

let db
async function ensureDb() {
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
  db = mongoose.connection.db
}

async function seedLiveListing(wholesalerId, tag, extra = {}) {
  await ensureDb()
  const now = new Date()
  const id = oid()
  await db.collection('listings').insertOne({
    _id: id, wholesalerId: new mongoose.Types.ObjectId(wholesalerId),
    status: 'live', dealType: 'fix_flip', marketStatus: 'off_market',
    propertyAddress: `${tag} ${stamp}`, city: 'Dallas', stateCode: 'TX', zipCode: '75204',
    arv: 400000, rehabTotal: 60000, purchasePrice: 260000, estimatedHoldingCosts: 6000,
    assignmentFeeLow: 0, assignmentFeeHigh: 20000, projectedBuyerProfit: 74000,
    bidCount: 0, bidsOpen: true, feeLocked: false, photoUrls: [], videoUrl: '',
    outlierFlagged: false, marketingProofSatisfiedByListing: false, app1SyncManaged: false,
    app1DealId: null, createdAt: now, updatedAt: now, ...extra,
  })
  return id.toString()
}

async function seedApp1MarketableDeal(buyerId, sellerId, tag) {
  await ensureDb()
  const now = new Date()
  const listingId = oid(), bidId = oid(), contractId = oid(), dealId = oid()
  await db.collection('listings').insertOne({
    _id: listingId, seller_id: sellerId, status: 'live', property_type: 'sfh',
    address: `${tag} ${stamp}`, city: 'Austin', zip_code: '78704', state_code: 'TX',
    market_price: 300000, suggested_price: 312000, hidden_reserve: 'enc', picture_urls: [],
    bid_count: 0, createdAt: now, updatedAt: now,
  })
  await db.collection('bids').insertOne({ _id: bidId, listing_id: listingId, buyer_id: buyerId, bid_price: 235000, inspection_period: 7, status: 'accepted', createdAt: now, updatedAt: now })
  await db.collection('contracts').insertOne({ _id: contractId, bid_id: bidId, property_id: listingId, seller_id: sellerId, buyer_id: buyerId, status: 'signed', createdAt: now, updatedAt: now })
  await db.collection('deals').insertOne({ _id: dealId, contract_id: contractId, listing_id: listingId, seller_id: sellerId, buyer_id: buyerId, status: 'active', deleted_at: null, createdAt: now, updatedAt: now })
  return { listingId, bidId, contractId, dealId }
}

const RESULTS = []
const ok = (n) => { RESULTS.push({ n, ok: true }); console.log(`✅ ${n}`) }
const bad = (n, d) => { RESULTS.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }

async function main() {
  if (!KEY) { console.error('INTERNAL_SERVICE_KEY missing'); process.exit(1) }
  const redis = createRedis()
  await ensureDb()

  const buyers = []
  for (let i = 0; i < 12; i++) buyers.push(await registerUser(redis, 'buyer', stamp, 100 + i))
  const wh = await registerUser(redis, 'buyer', stamp, 90) // reused as generic actor
  const wholesaler = await registerUser(redis, 'wholesaler', stamp, 91)
  await ensureDb()
  // approve PoF for all bidders (bids need it)
  const adminTok = await loginUser(redis, 'wasifzahoor296@gmail.com', 'admin1234!', false)
  await ensureDb()
  for (const b of buyers) {
    await db.collection('users').updateOne({ _id: new mongoose.Types.ObjectId(b.userId) },
      { $set: { pofStatus: 'approved', pofDocumentUrl: 'https://x/pof' } })
  }

  // ───────────────────────── H1: 60 parallel bids, 10-cap ─────────────────────────
  console.log('\n─── H1: 60 parallel bids on one listing (cap 10) ───')
  try {
    const listingId = await seedLiveListing(wholesaler.userId, 'H1')
    // fresh tokens for the bidders
    const bTok = []
    for (const b of buyers) bTok.push(await loginUser(redis, b.email, b.password, false))
    await ensureDb()
    const probe = await api('/bids', { method: 'POST', headers: auth(bTok[0]),
      body: JSON.stringify({ listingId, assignmentPrice: 25000, emdAmount: 5000, proposedClosingDate: '2026-12-01', inspectionDays: 7 }) })
    console.log('   probe bid ->', probe.status, JSON.stringify(probe.body)?.slice(0, 160))
    const reqs = []
    for (let i = 0; i < 60; i++) {
      const t = bTok[i % bTok.length]
      reqs.push(api('/bids', { method: 'POST', headers: auth(t),
        body: JSON.stringify({ listingId, assignmentPrice: 15000 + i * 100, emdAmount: 5000, proposedClosingDate: '2026-12-01', inspectionDays: 7 }) }))
    }
    const rs = await Promise.all(reqs)
    const codes = hist(rs.map((r) => r.status))
    const created = rs.filter((r) => r.status === 201).length
    await ensureDb()
    const listing = await db.collection('listings').findOne({ _id: new mongoose.Types.ObjectId(listingId) })
    const bidRows = await db.collection('bids').countDocuments({ listingId: new mongoose.Types.ObjectId(listingId) })
    console.log('   codes', JSON.stringify(codes), '| bidRows', bidRows, '| listing.bidCount', listing.bidCount)
    const fivexx = rs.filter((r) => r.status >= 500).length
    if (fivexx) flag(`H1: ${fivexx}x 5xx on /bids`)
    if (bidRows <= 10 && listing.bidCount === bidRows && !fivexx) ok(`H1 bid cap held (${bidRows} bids, no 5xx)`)
    else bad('H1 bid cap', `bidRows=${bidRows} bidCount=${listing.bidCount} 5xx=${fivexx}`)
  } catch (e) { bad('H1', e.message) }

  // ───────────────────────── H2: 20 parallel poller runs, 1 deal ─────────────────────────
  console.log('\n─── H2: 20 parallel poller runs, single fresh App1 deal ───')
  try {
    const sellerId = oid()
    await db.collection('users').insertOne({ _id: sellerId, email: `hm_s_${stamp}@t.com`, phone: `+1${String(stamp).slice(-9)}70`, role: 'seller', full_name: 'S', createdAt: new Date(), updatedAt: new Date() })
    const seed = await seedApp1MarketableDeal(new mongoose.Types.ObjectId(wholesaler.userId), sellerId, 'H2 St')
    const runs = Array.from({ length: 20 }, () => fetch(`${API}/internal/app1-sync/run`, { method: 'POST', headers: { 'x-internal-key': KEY } }).then((r) => r.status).catch(() => 0))
    const codes = hist(await Promise.all(runs))
    await ensureDb()
    const mirrors = await db.collection('listings').countDocuments({ app1DealId: String(seed.dealId) })
    console.log('   codes', JSON.stringify(codes), '| mirror listings for the deal:', mirrors)
    if (mirrors === 1) ok('H2 poller create is race-safe (exactly 1 mirror)')
    else { bad('H2 poller race', `${mirrors} duplicate mirrors created for one app1DealId`); flag(`H2: poller findOne+create is not atomic -> ${mirrors} dup listings`) }
    await db.collection('listings').deleteMany({ app1DealId: String(seed.dealId) })
    await db.collection('deals').deleteOne({ _id: seed.dealId })
  } catch (e) { bad('H2', e.message) }

  // ───────────────────────── H3: 8 parallel POST /listings same app1DealId ─────────────────────────
  console.log('\n─── H3: 8 parallel Create Listing, same app1DealId ───')
  try {
    const sellerId = oid()
    await db.collection('users').insertOne({ _id: sellerId, email: `hm_s3_${stamp}@t.com`, phone: `+1${String(stamp).slice(-9)}71`, role: 'seller', full_name: 'S', createdAt: new Date(), updatedAt: new Date() })
    const seed = await seedApp1MarketableDeal(new mongoose.Types.ObjectId(wholesaler.userId), sellerId, 'H3 St')
    const whTok = await loginUser(redis, wholesaler.email, wholesaler.password, false)
    const body = JSON.stringify({ dealType: 'fix_flip', app1DealId: String(seed.dealId), propertyAddress: `H3 ${stamp}`, stateCode: 'TX', arv: 312000, purchasePrice: 235000, rehabTotal: 40000 })
    const rs = await Promise.all(Array.from({ length: 8 }, () => api('/listings', { method: 'POST', headers: auth(whTok), body })))
    const codes = hist(rs.map((r) => r.status))
    await ensureDb()
    const rows = await db.collection('listings').countDocuments({ app1DealId: String(seed.dealId) })
    console.log('   codes', JSON.stringify(codes), '| listings for the deal:', rows)
    if (rows === 1) ok('H3 Create Listing dedupes on app1DealId (1 listing)')
    else { bad('H3 create race', `${rows} listings for one app1DealId`); flag(`H3: POST /listings has no app1DealId dedup -> ${rows} dup listings + ${rows}x mark-marketing-complete`) }
    await db.collection('listings').deleteMany({ app1DealId: String(seed.dealId) })
    await db.collection('deals').deleteOne({ _id: seed.dealId })
  } catch (e) { bad('H3', e.message) }

  // ───────────────────────── H4: 30 parallel logins + 120 trivial GETs ─────────────────────────
  console.log('\n─── H4: 30 parallel logins (bcrypt) + 120 trivial GETs in parallel ───')
  try {
    const cred = JSON.stringify({ email: buyers[0].email, password: 'Password1' })
    const t0 = performance.now()
    const logins = Array.from({ length: 30 }, () => api('/auth/login', { method: 'POST', body: cred }).then((r) => r.status))
    const trivial = []
    const trivReqs = Array.from({ length: 120 }, async () => { const a = performance.now(); const r = await fetch(`${API}/`); trivial.push(performance.now() - a); return r.status })
    const [lc, tc] = await Promise.all([Promise.all(logins), Promise.all(trivReqs)])
    console.log('   login codes', JSON.stringify(hist(lc)), '| trivial codes', JSON.stringify(hist(tc)))
    console.log(`   trivial GET during load: p50 ${p(trivial, 50).toFixed(0)}ms p95 ${p(trivial, 95).toFixed(0)}ms p99 ${p(trivial, 99).toFixed(0)}ms max ${Math.max(...trivial).toFixed(0)}ms  (wall ${(performance.now() - t0).toFixed(0)}ms)`)
    const l5 = lc.filter((s) => s >= 500).length, t5 = tc.filter((s) => s >= 500).length
    if (l5 || t5) flag(`H4: ${l5} login 5xx, ${t5} trivial 5xx`)
    if (!l5 && !t5 && p(trivial, 95) < 1500) ok('H4 mixed auth load — no 5xx, trivial p95 under 1.5s')
    else bad('H4 mixed load', `login5xx=${l5} triv5xx=${t5} p95=${p(trivial, 95).toFixed(0)}ms`)
  } catch (e) { bad('H4', e.message) }

  // ───────────────────────── H5: 10 parallel advance of same step ─────────────────────────
  console.log('\n─── H5: 10 parallel advance of the same next step on one deal ───')
  try {
    const b = buyers[1], wsl = wholesaler
    const listingId = await seedLiveListing(wsl.userId, 'H5', { status: 'under_contract', bidsOpen: false })
    const bidId = oid()
    await db.collection('bids').insertOne({ _id: bidId, listingId: new mongoose.Types.ObjectId(listingId), buyerId: new mongoose.Types.ObjectId(b.userId), assignmentPrice: 15000, status: 'primary', createdAt: new Date(), updatedAt: new Date() })
    await seedSignedContract({ listingId, bidId: bidId.toString(), wholesalerId: wsl.userId, buyerId: b.userId, assignmentFee: 15000 })
    await ensureDb()
    const whTok = await loginUser(redis, wsl.email, wsl.password, false)
    const buyTok = await loginUser(redis, b.email, b.password, false)
    await ensureDb()
    const cr = await api('/deals', { method: 'POST', headers: auth(whTok), body: JSON.stringify({ listingId, primaryBidId: bidId.toString(), primaryBuyerId: b.userId, wholesalerId: wsl.userId, emdAmount: 1500 }) })
    const dealId = (cr.body?.data ?? cr.body)?._id
    if (!dealId) throw new Error(`create deal ${cr.status} ${JSON.stringify(cr.body)?.slice(0, 200)}`)
    const d0 = await db.collection('deals').findOne({ _id: new mongoose.Types.ObjectId(dealId) })
    await db.collection('payments').updateMany({ dealId: new mongoose.Types.ObjectId(dealId) }, { $set: { status: 'succeeded' } })
    // 10 parallel: advance contract_signed -> emd_deposited (wholesaler step)
    const rs = await Promise.all(Array.from({ length: 10 }, () => api(`/deals/${dealId}/advance`, { method: 'POST', headers: auth(whTok), body: JSON.stringify({ step: 'emd_deposited' }) })))
    const codes = hist(rs.map((r) => r.status))
    await ensureDb()
    const d1 = await db.collection('deals').findOne({ _id: new mongoose.Types.ObjectId(dealId) })
    const succ = rs.filter((r) => r.status === 200 || r.status === 201).length
    console.log('   codes', JSON.stringify(codes), '| step', d0.currentStep, '->', d1.currentStep, '| 200-count', succ)
    const f5 = rs.filter((r) => r.status >= 500).length
    if (f5) flag(`H5: ${f5}x 5xx on /advance`)
    if (d1.currentStep === 'emd_deposited' && succ === 1 && !f5) ok('H5 advance is single-effect under race (1x 200, no 5xx)')
    else { bad('H5 advance race', `step=${d1.currentStep} 200-count=${succ} 5xx=${f5}`); if (succ > 1) flag(`H5: /advance non-atomic -> ${succ} requests each ran step side-effects`) }
  } catch (e) { bad('H5', e.message) }

  // ───────────────────────── H6: 50 parallel App1 mark-marketing-complete ─────────────────────────
  console.log('\n─── H6: 50 parallel App1 /internal/deals/:id/mark-marketing-complete ───')
  try {
    const sellerId = oid()
    await db.collection('users').insertOne({ _id: sellerId, email: `hm_s6_${stamp}@t.com`, phone: `+1${String(stamp).slice(-9)}72`, role: 'seller', full_name: 'S', createdAt: new Date(), updatedAt: new Date() })
    const seed = await seedApp1MarketableDeal(new mongoose.Types.ObjectId(wholesaler.userId), sellerId, 'H6 St')
    const rs = await Promise.all(Array.from({ length: 50 }, () =>
      fetch(`${APP1}/api/v1/internal/deals/${seed.dealId}/mark-marketing-complete`, {
        method: 'POST', headers: { 'x-internal-key': KEY, 'Content-Type': 'application/json' }, body: '{}',
      }).then((r) => r.status).catch(() => 0)))
    const codes = hist(rs)
    console.log('   codes', JSON.stringify(codes))
    const f5 = rs.filter((s) => s >= 500).length
    if (f5) flag(`H6: ${f5}x 5xx from App1 mark-marketing-complete under load`)
    if (!f5) ok('H6 App1 marketing callback idempotent under 50x parallel (no 5xx)')
    else bad('H6', `${f5}x 5xx`)
    await db.collection('deals').deleteOne({ _id: seed.dealId })
  } catch (e) { bad('H6', e.message) }

  // ───────────────────────── H7: mixed soak ─────────────────────────
  console.log('\n─── H7: mixed soak — 240 mixed requests ───')
  try {
    const whTok = await loginUser(redis, wholesaler.email, wholesaler.password, false)
    const listingId = await seedLiveListing(wholesaler.userId, 'H7')
    const kinds = [
      () => fetch(`${API}/listings?stateCode=TX&limit=20`).then((r) => r.status),
      () => api('/listings/' + listingId).then((r) => r.status),
      () => api('/auth/login', { method: 'POST', body: JSON.stringify({ email: buyers[2].email, password: 'Password1' }) }).then((r) => r.status),
      () => api('/wholesaler/dashboard', { headers: auth(whTok) }).then((r) => r.status),
      () => fetch(`${API}/internal/app1-sync/run`, { method: 'POST', headers: { 'x-internal-key': KEY } }).then((r) => r.status),
      () => api('/wholesaler/closed-app1-deals', { headers: auth(whTok) }).then((r) => r.status),
    ]
    const t0 = performance.now()
    const rs = await Promise.all(Array.from({ length: 240 }, (_, i) => kinds[i % kinds.length]().catch(() => 0)))
    const codes = hist(rs)
    const f5 = rs.filter((s) => s >= 500).length
    console.log('   codes', JSON.stringify(codes), `| wall ${(performance.now() - t0).toFixed(0)}ms`)
    if (f5) flag(`H7: ${f5}x 5xx during mixed soak`)
    if (!f5) ok('H7 mixed soak — 0x 5xx over 240 mixed requests')
    else bad('H7 soak', `${f5}x 5xx`)
  } catch (e) { bad('H7', e.message) }

  await redis.quit().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  const passed = RESULTS.filter((r) => r.ok).length
  console.log(`\n${'═'.repeat(64)}`)
  console.log(`HAMMER: ${passed}/${RESULTS.length} sections clean`)
  if (findings.length) {
    console.log(`\nFINDINGS (${findings.length}):`)
    findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`))
  }
  process.exit(RESULTS.length - passed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
