#!/usr/bin/env node
/**
 * App1 -> App2 listing bridge (App2-only pull sync).
 *
 * Seeds an App1-shaped signed deal directly in the shared DB, hits the internal
 * sync endpoint, and asserts App2 materialised a live marketplace listing
 * linked by app1DealId. Then flips the App1 deal to cancelled and asserts the
 * mirror is retired.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
const KEY = process.env.INTERNAL_SERVICE_KEY
const stamp = Date.now()
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log(`✅ ${n}`) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }
const oid = () => new mongoose.Types.ObjectId()

async function runSync() {
  const r = await fetch(`${API}/internal/app1-sync/run`, {
    method: 'POST',
    headers: { 'x-internal-key': KEY, 'Content-Type': 'application/json' },
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}

async function main() {
  if (!KEY) { console.error('INTERNAL_SERVICE_KEY missing'); process.exit(1) }
  await mongoose.connect(process.env.MONGODB_URI)
  const db = mongoose.connection.db
  const now = new Date()

  // ---- seed App1-shaped rows: seller listing + wholesaler + bid + contract + deal
  const sellerId = oid()
  const wholesalerId = oid()
  const listingId = oid()
  const bidId = oid()
  const contractId = oid()

  await db.collection('users').insertMany([
    { _id: sellerId, email: `sync_seller_${stamp}@test.com`, phone: `+1${String(stamp).slice(-9)}01`, role: 'seller', full_name: 'Sync Seller', createdAt: now, updatedAt: now },
    { _id: wholesalerId, email: `sync_wh_${stamp}@test.com`, phone: `+1${String(stamp).slice(-9)}02`, role: 'wholesaler', full_name: 'Sync Wholesaler', createdAt: now, updatedAt: now },
  ])
  await db.collection('listings').insertOne({
    _id: listingId, seller_id: sellerId, status: 'live', property_type: 'sfh',
    address: `900 Bridge Test Rd ${stamp}`, city: 'Austin', zip_code: '78704', state_code: 'TX',
    year_built: 2001, market_price: 300000, hidden_reserve: 'enc:xxx', suggested_price: 315000,
    picture_urls: ['https://example.com/p1.jpg'], bid_count: 0, createdAt: now, updatedAt: now,
  })
  await db.collection('bids').insertOne({
    _id: bidId, listing_id: listingId, buyer_id: wholesalerId, bid_price: 240000,
    inspection_period: 7, net_to_seller: 240000, status: 'accepted', createdAt: now, updatedAt: now,
  })
  await db.collection('contracts').insertOne({
    _id: contractId, bid_id: bidId, property_id: listingId, seller_id: sellerId,
    buyer_id: wholesalerId, status: 'signed', createdAt: now, updatedAt: now,
  })
  const dealId = oid()
  await db.collection('deals').insertOne({
    _id: dealId, contract_id: contractId, listing_id: listingId, seller_id: sellerId,
    buyer_id: wholesalerId, status: 'active', marketing_deadline: new Date(Date.now() + 72 * 3600e3),
    chat_unlocked: true, deleted_at: null, createdAt: now, updatedAt: now,
  })

  // ---- 1. sync creates the mirror
  try {
    const r = await runSync()
    const app2 = await db.collection('listings').findOne({ app1DealId: String(dealId) })
    if (r.status === 201 && app2 &&
        app2.status === 'live' && app2.bidsOpen === true &&
        String(app2.wholesalerId) === String(wholesalerId) &&
        app2.propertyAddress === `900 Bridge Test Rd ${stamp}` &&
        app2.stateCode === 'TX' && app2.arv === 315000 && app2.purchasePrice === 240000 &&
        app2.marketingProofSatisfiedByListing === true &&
        String(app2.app1ContractId) === String(contractId) &&
        String(app2.app1PropertyId) === String(listingId)) {
      pass(`sync created live App2 listing from App1 deal (counts ${JSON.stringify(r.body)})`)
    } else {
      fail('sync create', `status=${r.status} mirror=${JSON.stringify(app2)?.slice(0, 400)}`)
    }
  } catch (e) { fail('sync create', e.message) }

  // ---- 2. idempotent: second run makes no duplicate
  try {
    await runSync()
    const count = await db.collection('listings').countDocuments({ app1DealId: String(dealId) })
    if (count === 1) pass('re-running sync does not duplicate the mirror')
    else fail('sync idempotency', `mirror count = ${count}`)
  } catch (e) { fail('sync idempotency', e.message) }

  // ---- 3. marketplace can see it (public listing feed)
  try {
    const r = await fetch(`${API}/listings?stateCode=TX&limit=100`)
    const body = await r.json().catch(() => ({}))
    const rows = body?.data?.listings ?? body?.data ?? []
    const found = Array.isArray(rows) && rows.some(
      (l) => l.propertyAddress === `900 Bridge Test Rd ${stamp}` || String(l.app1DealId) === String(dealId),
    )
    if (found) pass('mirrored listing appears in the public marketplace feed')
    else fail('marketplace visibility', `not found in ${Array.isArray(rows) ? rows.length : '?'} rows`)
  } catch (e) { fail('marketplace visibility', e.message) }

  // ---- 4. App1 deal dies -> mirror retired
  try {
    await db.collection('deals').updateOne({ _id: dealId }, { $set: { status: 'cancelled' } })
    await runSync()
    const app2 = await db.collection('listings').findOne({ app1DealId: String(dealId) })
    if (app2 && app2.status === 'cancelled' && app2.bidsOpen === false) {
      pass('App1 deal cancelled -> App2 mirror retired (cancelled, bids closed)')
    } else {
      fail('mirror retire', `mirror status=${app2?.status} bidsOpen=${app2?.bidsOpen}`)
    }
  } catch (e) { fail('mirror retire', e.message) }

  // ---- 5. end-buyer deal is ignored (nothing to re-market)
  try {
    const ebId = oid()
    const buyerUser = oid()
    await db.collection('users').insertOne({ _id: buyerUser, email: `sync_eb_${stamp}@test.com`, phone: `+1${String(stamp).slice(-9)}03`, role: 'buyer', full_name: 'End Buyer', createdAt: now, updatedAt: now })
    await db.collection('deals').insertOne({
      _id: ebId, contract_id: oid(), listing_id: listingId, seller_id: sellerId,
      buyer_id: buyerUser, status: 'active', deleted_at: null, createdAt: now, updatedAt: now,
    })
    await runSync()
    const mirror = await db.collection('listings').findOne({ app1DealId: String(ebId) })
    if (!mirror) pass('end-buyer App1 deal is skipped (no mirror created)')
    else fail('end-buyer skip', `unexpected mirror ${String(mirror._id)}`)
    await db.collection('deals').deleteOne({ _id: ebId })
    await db.collection('users').deleteOne({ _id: buyerUser })
  } catch (e) { fail('end-buyer skip', e.message) }

  // ---- cleanup
  await db.collection('listings').deleteMany({ $or: [{ app1DealId: String(dealId) }, { _id: listingId }] })
  await db.collection('deals').deleteMany({ _id: dealId })
  await db.collection('contracts').deleteOne({ _id: contractId })
  await db.collection('bids').deleteOne({ _id: bidId })
  await db.collection('users').deleteMany({ _id: { $in: [sellerId, wholesalerId] } })

  await mongoose.disconnect()
  const p = results.filter((r) => r.ok).length
  console.log(`\n${'─'.repeat(60)}\nPassed: ${p} | Failed: ${results.length - p} (of ${results.length})`)
  process.exit(results.length - p > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
