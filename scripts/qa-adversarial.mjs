import { api, auth, registerUser, loginUser, createRedis, seedSignedContract } from './qa-lib.mjs'
import mongoose from 'mongoose'

const ensureConn = async () => { if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI) }
const coll = async (n) => { await ensureConn(); return mongoose.connection.db.collection(n) }

const ROOT = 'http://localhost:3001'
const SECRET = process.env.DOCUSEAL_WEBHOOK_SECRET
const URI = process.env.MONGODB_URI
const redis = createRedis()
const out = []
const ok = (n, d = '') => { out.push({ n, ok: true }); console.log(`✅ ${n}${d ? ' — ' + d : ''}`) }
const bad = (n, d) => { out.push({ n, ok: false, d }); console.log(`🐛 ${n} — ${d}`) }
const info = (n, d) => console.log(`•  ${n} — ${d}`)

async function freshListingLive(wh, admin, stamp, fee = 12000) {
  let r = await api('/listings', { method: 'POST', headers: auth(wh.accessToken), body: JSON.stringify({ dealType: 'fix_flip', marketStatus: 'off_market' }) })
  const id = r.body.data._id
  await api(`/listings/${id}`, { method: 'PATCH', headers: auth(wh.accessToken), body: JSON.stringify({
    propertyAddress: `Adv ${stamp}`, city: 'Dallas', stateCode: 'TX', zipCode: '75201',
    arv: 400000, rehabTotal: 60000, purchasePrice: 280000, assignmentFeeLow: fee, assignmentFeeHigh: fee + 6000, estimatedHoldingCosts: 6000,
  }) })
  await api(`/listings/${id}/publish`, { method: 'POST', headers: auth(wh.accessToken) })
  await api(`/admin/listings/${id}/review`, { method: 'POST', headers: auth(admin), body: JSON.stringify({ action: 'approve' }) })
  return id
}

async function main() {
  console.log('\n🗡️  TRACT App2 adversarial\n')
  await mongoose.connect(URI)
  const stamp = Date.now()
  const admin = await loginUser(redis, 'wasifzahoor296@gmail.com', 'admin1234!', false)
  const wh = await registerUser(redis, 'wholesaler', stamp, 1)

  // ── 1. Bid-cap race: 20 buyers bid in parallel, cap is 10 ──
  {
    const listingId = await freshListingLive(wh, admin, stamp + 10)
    const buyers = await Promise.all(Array.from({ length: 20 }, (_, i) => registerUser(redis, 'buyer', stamp, 100 + i)))
    const res = await Promise.all(buyers.map((b) =>
      api('/bids', { method: 'POST', headers: auth(b.accessToken), body: JSON.stringify({ listingId, assignmentPrice: 15000 }) })))
    const created = res.filter((r) => r.status === 201).length
    const fives = res.filter((r) => r.status >= 500).length
    const dbCount = await (await coll('bids')).countDocuments({ listingId: new mongoose.Types.ObjectId(listingId) })
    if (fives) bad('Bid-cap race', `${fives} × 5xx`)
    if (created > 10 || dbCount > 10) bad('Bid-cap race — 10-bid cap not atomic', `${created} created / ${dbCount} in DB (max 10)`)
    else ok('Bid-cap race holds at 10', `${created} created / ${dbCount} in DB`)
  }

  // ── 2. Deal-advance race + platform-fee bypass ──
  let dealId, buyer
  {
    const listingId = await freshListingLive(wh, admin, stamp + 20)
    buyer = await registerUser(redis, 'buyer', stamp, 300)
    let r = await api('/bids', { method: 'POST', headers: auth(buyer.accessToken), body: JSON.stringify({ listingId, assignmentPrice: 15000 }) })
    const bidId = r.body.data._id
    await api(`/bids/listing/${listingId}/select`, { method: 'POST', headers: auth(wh.accessToken), body: JSON.stringify({ primaryBidId: bidId }) })
    await seedSignedContract({ listingId, bidId, wholesalerId: wh.userId, buyerId: buyer.userId, assignmentFee: 15000 })
    r = await api('/deals', { method: 'POST', headers: auth(wh.accessToken), body: JSON.stringify({ listingId, primaryBidId: bidId, primaryBuyerId: buyer.userId, wholesalerId: wh.userId, emdAmount: 1500 }) })
    dealId = r.body?.data?._id
    if (!dealId) { bad('Deal setup', JSON.stringify(r.body).slice(0, 160)) }
    else {
      // 2a. non-admin owner tries to advance to step 4 (buyer step) — should be blocked (role) or fee
      r = await api(`/deals/${dealId}/advance`, { method: 'POST', headers: auth(wh.accessToken), body: JSON.stringify({ step: 'emd_deposited' }) })
      // owner advancing early steps WITHOUT platform fee paid
      if (r.status === 200 || r.ok) bad('Platform-fee gate (owner, step 2)', `advanced to emd_deposited with no fees paid (status ${r.status})`)
      else ok('Platform-fee gate blocks owner step-2 without fees', `status ${r.status}`)

      // 2b. buyer jumps straight to funded_closed
      r = await api(`/deals/${dealId}/advance`, { method: 'POST', headers: auth(buyer.accessToken), body: JSON.stringify({ step: 'funded_closed' }) })
      if (r.ok) bad('Step-order bypass', 'buyer jumped to funded_closed')
      else ok('Step-order enforced', `status ${r.status}`)

      // 2c. parallel identical advance (admin, no fee gate) — race
      const adv = await Promise.all(Array.from({ length: 6 }, () =>
        api(`/deals/${dealId}/advance`, { method: 'POST', headers: auth(admin), body: JSON.stringify({ step: 'emd_deposited' }) })))
      const advOk = adv.filter((x) => x.ok).length
      const adv5 = adv.filter((x) => x.status >= 500).length
      const dealDoc = await (await coll('deals')).findOne({ _id: new mongoose.Types.ObjectId(dealId) })
      if (adv5) bad('Advance race', `${adv5} × 5xx`)
      info('Advance race', `${advOk}/6 ok, deal now at "${dealDoc.currentStep}"`)
      if (dealDoc.currentStep !== 'emd_deposited') bad('Advance race corrupted step', `expected emd_deposited got ${dealDoc.currentStep}`)
      else ok('Advance race leaves consistent step', dealDoc.currentStep)
    }
  }

  // ── 3. IDOR sweep — stranger token on another deal's resources ──
  if (dealId) {
    const stranger = await registerUser(redis, 'buyer', stamp, 500)
    const targets = [
      ['GET deal', `/deals/${dealId}`, {}],
      ['GET vault', `/deals/${dealId}/vault`, {}],
      ['POST vault', `/deals/${dealId}/vault`, { method: 'POST', body: JSON.stringify({ docType: 'other', url: 'http://x/y.pdf', name: 'x' }) }],
      ['GET chat', `/chat/${dealId}`, {}],
      ['POST chat', `/chat`, { method: 'POST', body: JSON.stringify({ dealId, message: 'hi' }) }],
      ['advance', `/deals/${dealId}/advance`, { method: 'POST', body: JSON.stringify({ step: 'inspection_period' }) }],
      ['freeze', `/deals/${dealId}/freeze`, { method: 'POST', body: JSON.stringify({ reason: 'x' }) }],
    ]
    let leaks = 0
    for (const [name, path, opt] of targets) {
      const r = await api(path, { ...opt, headers: auth(stranger.accessToken) })
      if (r.ok) { leaks++; bad(`IDOR: ${name}`, `stranger got ${r.status}`) }
    }
    if (!leaks) ok('IDOR sweep — all 7 stranger accesses denied')
  }

  // ── 4. Payload abuse — must be 4xx, never 5xx ──
  {
    const cases = [
      ['huge assignmentPrice', '/bids', { listingId: 'x', assignmentPrice: 1e308 }],
      ['NaN price', '/bids', { listingId: 'x', assignmentPrice: 'NaN' }],
      ['neg price', '/bids', { listingId: 'x', assignmentPrice: -5 }],
      ['proto pollution', '/bids', JSON.parse('{"__proto__":{"admin":true},"listingId":"x","assignmentPrice":1}')],
      ['huge string listing patch', `/listings/000000000000000000000000`, { propertyAddress: 'A'.repeat(200000) }],
      ['deep nest', '/bids', { listingId: { a: { b: { c: { d: { e: 1 } } } } }, assignmentPrice: 1 }],
      ['unicode', '/bids', { listingId: '𝕏'.repeat(500), assignmentPrice: 1 }],
    ]
    let fives = 0
    for (const [name, path, body] of cases) {
      const method = path.includes('listings/0000') ? 'PATCH' : 'POST'
      const r = await api(path, { method, headers: auth(wh.accessToken), body: JSON.stringify(body) })
      if (r.status >= 500) { fives++; bad(`Payload abuse: ${name}`, `5xx ${JSON.stringify(r.body).slice(0, 120)}`) }
    }
    if (!fives) ok('Payload abuse — 0 × 5xx across 7 hostile payloads')
  }

  // ── 5. Rating rules — only after funded_closed, once per rater ──
  if (dealId) {
    let r = await api('/ratings', { method: 'POST', headers: auth(buyer.accessToken), body: JSON.stringify({ dealId, stars: 5, comment: 'early' }) })
    if (r.ok) bad('Rating before funded_closed', `accepted (status ${r.status})`)
    else ok('Rating rejected before funded_closed', `status ${r.status}`)
    // drive to funded_closed via admin
    for (const s of ['emd_deposited', 'inspection_period', 'appraisal_ordered', 'financing_approved', 'title_search_complete', 'clear_to_close', 'funded_closed']) {
      await api(`/deals/${dealId}/advance`, { method: 'POST', headers: auth(admin), body: JSON.stringify({ step: s }) })
    }
    r = await api('/ratings', { method: 'POST', headers: auth(buyer.accessToken), body: JSON.stringify({ dealId, stars: 5, comment: 'ok' }) })
    const first = r.ok
    r = await api('/ratings', { method: 'POST', headers: auth(buyer.accessToken), body: JSON.stringify({ dealId, stars: 1, comment: 'again' }) })
    if (first && r.ok) bad('Duplicate rating', 'same rater rated twice')
    else if (first) ok('Duplicate rating blocked')
    else info('Rating post-close', `first rating status unexpected`)
  }

  // ── 6. DocuSeal webhook: wrong secret + unknown contract + replay ──
  {
    let r = await fetch(`${ROOT}/webhooks/docuseal-app2/WRONG`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'submitter_completed', data: {} }) })
    if (r.status === 200) bad('DocuSeal webhook bad secret', 'accepted')
    else ok('DocuSeal webhook rejects bad secret', `status ${r.status}`)
    r = await fetch(`${ROOT}/webhooks/docuseal-app2/${SECRET}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'submitter_completed', data: { external_id: '000000000000000000000000:lister' } }) })
    if (r.status >= 500) bad('DocuSeal webhook unknown contract', `5xx ${r.status}`)
    else ok('DocuSeal webhook unknown contract handled', `status ${r.status}`)
  }

  await mongoose.disconnect()
  await redis.quit()
  const bugs = out.filter((x) => !x.ok)
  console.log(`\n────────────────────────────────\n${out.filter((x) => x.ok).length} ok, ${bugs.length} suspected bug(s)`)
  bugs.forEach((b) => console.log(`  🐛 ${b.n}: ${b.d}`))
  process.exit(bugs.length ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
