#!/usr/bin/env node
/**
 * App1 <-> App2 listing integration — BOTH paths, run together.
 *
 *  Path B (wholesaler-initiated): App2 pulls the wholesaler's App1 deals live
 *    from App1 (/internal/deals/listable-by-user), the wholesaler picks one in
 *    Create Listing (app1DealId), App2 calls back /internal/deals/:id/
 *    mark-marketing-complete. Needs App1 backend on the `new-changes-by-qaiser`
 *    branch (internal-deals / internal-bids controllers).
 *
 *  Path A (poller): App2's App1SyncService reads App1-shaped signed deals from
 *    the shared DB and auto-materialises live marketplace listings. Runs on a
 *    timer; also triggerable at POST /internal/app1-sync/run.
 *
 *  Coexistence: the poller only ever touches listings IT created
 *    (app1SyncManaged=true). A wholesaler-made listing for the same app1DealId
 *    is left alone, and stops reappearing in the wholesaler's Property Source.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { api, auth, registerUser, loginUser, createRedis } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const APP1 = (process.env.APP1_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const KEY = process.env.INTERNAL_SERVICE_KEY
const stamp = Date.now()
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log(`✅ ${n}`) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }
const oid = () => new mongoose.Types.ObjectId()

async function runPoller() {
  const r = await fetch(`${API}/internal/app1-sync/run`, {
    method: 'POST', headers: { 'x-internal-key': KEY, 'Content-Type': 'application/json' },
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

/** Seed one App1-shaped signed deal (listing + bid + contract + deal) for `buyerId`. */
async function seedApp1Deal(db, buyerId, sellerId, tag) {
  const now = new Date()
  const listingId = oid(), bidId = oid(), contractId = oid(), dealId = oid()
  await db.collection('listings').insertOne({
    _id: listingId, seller_id: sellerId, status: 'live', property_type: 'sfh',
    address: `${tag} St ${stamp}`, city: 'Austin', zip_code: '78704', state_code: 'TX',
    year_built: 2004, market_price: 305000, hidden_reserve: 'enc:x', suggested_price: 318000,
    picture_urls: [], bid_count: 0, createdAt: now, updatedAt: now,
  })
  await db.collection('bids').insertOne({
    _id: bidId, listing_id: listingId, buyer_id: buyerId, bid_price: 236000,
    inspection_period: 7, net_to_seller: 236000, status: 'accepted', createdAt: now, updatedAt: now,
  })
  await db.collection('contracts').insertOne({
    _id: contractId, bid_id: bidId, property_id: listingId, seller_id: sellerId,
    buyer_id: buyerId, status: 'signed', createdAt: now, updatedAt: now,
  })
  await db.collection('deals').insertOne({
    _id: dealId, contract_id: contractId, listing_id: listingId, seller_id: sellerId,
    buyer_id: buyerId, status: 'active',
    marketing_deadline: new Date(Date.now() + 72 * 3600e3),
    chat_unlocked: true, deleted_at: null, createdAt: now, updatedAt: now,
  })
  return { listingId, bidId, contractId, dealId }
}

async function main() {
  if (!KEY) { console.error('INTERNAL_SERVICE_KEY missing'); process.exit(1) }

  // sanity: App1 qaiser internal endpoint reachable
  const ping = await fetch(`${APP1}/api/v1/internal/deals/listable-by-user/${oid()}`, {
    headers: { 'x-internal-key': KEY },
  }).catch(() => null)
  if (!ping || (ping.status !== 200 && ping.status !== 201)) {
    fail('precheck', `App1 internal endpoint not reachable (status ${ping?.status}). Is App1 on new-changes-by-qaiser + running on :3000?`)
    finish()
    return
  }
  pass('precheck — App1 (qaiser) internal endpoints reachable with shared key')

  const redis = createRedis()
  await mongoose.connect(process.env.MONGODB_URI)
  const db = mongoose.connection.db

  // Two App2 wholesalers (shared users collection => same _id valid in App1).
  const whB = await registerUser(redis, 'wholesaler', stamp, 10) // Path B actor
  const whA = await registerUser(redis, 'wholesaler', stamp, 11) // Path A actor
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
  const sellerId = oid()
  await db.collection('users').insertOne({
    _id: sellerId, email: `int_seller_${stamp}@test.com`, phone: `+1${String(stamp).slice(-9)}09`,
    role: 'seller', full_name: 'Int Seller', createdAt: new Date(), updatedAt: new Date(),
  })

  const seedB = await seedApp1Deal(db, new mongoose.Types.ObjectId(whB.userId), sellerId, 'PathB')
  const seedA = await seedApp1Deal(db, new mongoose.Types.ObjectId(whA.userId), sellerId, 'PathA')

  // ─────────────── PATH B — wholesaler-initiated ───────────────
  let whBTok
  try {
    whBTok = await loginUser(redis, whB.email, whB.password, false)
  } catch (e) { fail('Path B — login wholesaler', e.message); }

  try {
    const r = await api('/wholesaler/closed-app1-deals', { headers: auth(whBTok) })
    const rows = r.body?.data ?? r.body ?? []
    const ids = (Array.isArray(rows) ? rows : []).map((d) => String(d.dealId ?? d._id ?? d.id))
    if (r.ok && ids.includes(String(seedB.dealId)) && !ids.includes(String(seedA.dealId))) {
      pass('Path B — GET /wholesaler/closed-app1-deals pulls this wholesaler\'s App1 deal (live App1 HTTP call)')
    } else {
      fail('Path B — listable pull', `status=${r.status} ids=${JSON.stringify(ids)} want ${seedB.dealId}`)
    }
  } catch (e) { fail('Path B — listable pull', e.message) }

  let pathBListingId
  try {
    const r = await api('/listings', {
      method: 'POST', headers: auth(whBTok),
      body: JSON.stringify({
        dealType: 'fix_flip', app1DealId: String(seedB.dealId),
        propertyAddress: `PathB St ${stamp}`, city: 'Austin', stateCode: 'TX', zipCode: '78704',
        arv: 318000, purchasePrice: 236000, rehabTotal: 40000, assignmentFeeHigh: 15000,
      }),
    })
    pathBListingId = (r.body?.data ?? r.body)?._id
    if (r.status === 201 && pathBListingId) pass('Path B — wholesaler creates App2 listing linked to app1DealId')
    else fail('Path B — create listing', `status=${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`)
  } catch (e) { fail('Path B — create listing', e.message) }

  try {
    // App2 -> App1 callback: mark-marketing-complete fired during create.
    const d = await db.collection('deals').findOne({ _id: seedB.dealId })
    if (d?.marketing_proof_url && String(d.marketing_proof_url).length > 0) {
      pass(`Path B — App2 called App1 mark-marketing-complete (deal.marketing_proof_url = "${d.marketing_proof_url}")`)
    } else {
      fail('Path B — marketing callback', `App1 deal.marketing_proof_url still empty (${JSON.stringify(d?.marketing_proof_url)})`)
    }
  } catch (e) { fail('Path B — marketing callback', e.message) }

  try {
    const r = await api('/wholesaler/closed-app1-deals', { headers: auth(whBTok) })
    const rows = r.body?.data ?? r.body ?? []
    const ids = (Array.isArray(rows) ? rows : []).map((d) => String(d.dealId ?? d._id ?? d.id))
    if (!ids.includes(String(seedB.dealId))) pass('Path B — linked deal no longer offered in Property Source')
    else fail('Path B — dedupe', 'linked deal still listed as available')
  } catch (e) { fail('Path B — dedupe', e.message) }

  // ─────────────── PATH A — poller ───────────────
  try {
    const r = await runPoller()
    const mirror = await db.collection('listings').findOne({ app1DealId: String(seedA.dealId) })
    if (r.status === 201 && mirror && mirror.status === 'live' &&
        mirror.app1SyncManaged === true &&
        String(mirror.wholesalerId) === String(whA.userId)) {
      pass(`Path A — poller auto-materialised live listing for un-listed App1 deal (counts ${JSON.stringify(r.body?.data ?? r.body)})`)
    } else {
      fail('Path A — poller create', `status=${r.status} mirror=${JSON.stringify(mirror)?.slice(0, 300)}`)
    }
  } catch (e) { fail('Path A — poller create', e.message) }

  // ─────────────── COEXISTENCE ───────────────
  try {
    const bMirror = await db.collection('listings').find({ app1DealId: String(seedB.dealId) }).toArray()
    const bStillDraft = bMirror.length === 1 && bMirror[0].status === 'draft' && !bMirror[0].app1SyncManaged
    if (bStillDraft) {
      pass('Coexistence — poller did NOT duplicate or promote the wholesaler-made Path B listing')
    } else {
      fail('Coexistence — poller left Path B alone', `count=${bMirror.length} status=${bMirror[0]?.status} synced=${bMirror[0]?.app1SyncManaged}`)
    }
  } catch (e) { fail('Coexistence — Path B untouched', e.message) }

  try {
    // Path A deal now has a poller listing -> it must not show up as "listable"
    // for whA in Create Listing (already used as a source).
    const whATok = await loginUser(redis, whA.email, whA.password, false)
    const r = await api('/wholesaler/closed-app1-deals', { headers: auth(whATok) })
    const rows = r.body?.data ?? r.body ?? []
    const ids = (Array.isArray(rows) ? rows : []).map((d) => String(d.dealId ?? d._id ?? d.id))
    if (!ids.includes(String(seedA.dealId))) pass('Coexistence — poller-materialised deal is excluded from that wholesaler\'s Property Source')
    else fail('Coexistence — Path A dedupe', 'poller-made deal still offered for manual listing')
  } catch (e) { fail('Coexistence — Path A dedupe', e.message) }

  try {
    // App1 deal for Path A dies -> poller retires ITS mirror.
    await db.collection('deals').updateOne({ _id: seedA.dealId }, { $set: { status: 'cancelled' } })
    await runPoller()
    const mirror = await db.collection('listings').findOne({ app1DealId: String(seedA.dealId) })
    if (mirror?.status === 'cancelled' && mirror.bidsOpen === false) {
      pass('Coexistence — App1 deal cancelled -> poller retires its own mirror')
    } else {
      fail('Coexistence — poller retire', `mirror status=${mirror?.status} bidsOpen=${mirror?.bidsOpen}`)
    }
  } catch (e) { fail('Coexistence — poller retire', e.message) }

  // ─────────────── cleanup ───────────────
  await db.collection('listings').deleteMany({
    $or: [{ app1DealId: String(seedA.dealId) }, { app1DealId: String(seedB.dealId) },
          { _id: { $in: [seedA.listingId, seedB.listingId] } }],
  })
  await db.collection('deals').deleteMany({ _id: { $in: [seedA.dealId, seedB.dealId] } })
  await db.collection('contracts').deleteMany({ _id: { $in: [seedA.contractId, seedB.contractId] } })
  await db.collection('bids').deleteMany({ _id: { $in: [seedA.bidId, seedB.bidId] } })
  await db.collection('users').deleteOne({ _id: sellerId })

  await redis.quit().catch(() => {})
  await mongoose.disconnect().catch(() => {})
  finish()
}

function finish() {
  const p = results.filter((r) => r.ok).length
  console.log(`\n${'─'.repeat(60)}\nPassed: ${p} | Failed: ${results.length - p} (of ${results.length})`)
  process.exit(results.length - p > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
