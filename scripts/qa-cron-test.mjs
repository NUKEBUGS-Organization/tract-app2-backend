#!/usr/bin/env node
/**
 * Scoring / penalty automation (BullMQ delayed-job) edge cases.
 *
 * App2 has NO @nestjs/schedule cron. All "automation" is BullMQ delayed jobs:
 *   kill-switch:  check-72hr-deadline, check-7day-realtor, check-backup-activation
 *   activity:     check-30day-inactivity
 * This script enqueues those jobs against the running worker and checks the
 * side effects — focusing on idempotency (jobs have attempts:3, so a retry
 * after a partial failure re-runs process() on the same deal).
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import mongoose from 'mongoose'
import { Queue } from 'bullmq'
import { createRedis, createDealFixture } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'
const stamp = Date.now()
const results = []
const pass = (n) => { results.push({ n, ok: true }); console.log(`✅ ${n}`) }
const fail = (n, d) => { results.push({ n, ok: false, d }); console.log(`❌ ${n}\n   ${d}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let db
const oid = (s) => new mongoose.Types.ObjectId(String(s))

/** Poll a predicate against a fresh DB read until true or timeout. */
async function waitFor(fn, { tries = 30, gap = 300 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true
    await sleep(gap)
  }
  return false
}

async function getDeal(id) { return db.collection('deals').findOne({ _id: oid(id) }) }
async function getUser(id) { return db.collection('users').findOne({ _id: oid(id) }) }
async function penaltyCount(userId, dealId) {
  return db.collection('penalties').countDocuments({ userId: oid(userId), dealId: oid(dealId) })
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  db = mongoose.connection.db
  const redis = createRedis()
  const killQ = new Queue('kill-switch', { connection: { url: REDIS_URL } })
  const actQ = new Queue('activity', { connection: { url: REDIS_URL } })

  // ── A/B: 72hr kill switch — fire once, then simulate a retry ───────────────
  try {
    const fx = await createDealFixture(redis, stamp)
    // reconnect: seedSignedContract inside the fixture disconnects mongoose
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    db = mongoose.connection.db

    await db.collection('deals').updateOne(
      { _id: oid(fx.dealId) },
      { $set: { marketingProofDeadline: new Date(Date.now() - 3600_000), marketingProofUploaded: false, killSwitchFired: false } },
    )
    const before = (await getUser(fx.wholesaler.userId)).reliabilityScore

    await killQ.add('check-72hr-deadline', { dealId: fx.dealId }, { jobId: `t-72-${stamp}` })
    const fired = await waitFor(async () => (await getDeal(fx.dealId)).killSwitchFired === true)
    const afterOne = (await getUser(fx.wholesaler.userId)).reliabilityScore
    const pen1 = await penaltyCount(fx.wholesaler.userId, fx.dealId)

    if (fired && afterOne === before - 15 && pen1 === 1) {
      pass(`72hr kill switch: -15 score, killSwitchFired set, 1 penalty (was ${before} → ${afterOne})`)
    } else {
      fail('72hr kill switch first run', `fired=${fired} before=${before} after=${afterOne} penalties=${pen1}`)
    }

    // Simulate a BullMQ retry: same job name + data runs process() again.
    await killQ.add('check-72hr-deadline', { dealId: fx.dealId }, { jobId: `t-72r-${stamp}` })
    await sleep(2500)
    const afterTwo = (await getUser(fx.wholesaler.userId)).reliabilityScore
    const pen2 = await penaltyCount(fx.wholesaler.userId, fx.dealId)

    if (afterTwo === afterOne && pen2 === pen1) {
      pass(`72hr kill switch is idempotent on retry (score stayed ${afterTwo}, penalties ${pen2})`)
    } else {
      fail('72hr kill switch retry', `DOUBLE PENALTY: score ${afterOne} → ${afterTwo}, penalties ${pen1} → ${pen2}. handle72hrDeadline() has no killSwitchFired guard.`)
    }

    // ── D: 7-day realtor job stacking on the same deal ──────────────────────
    await killQ.add('check-7day-realtor', { dealId: fx.dealId }, { jobId: `t-7d-${stamp}` })
    await sleep(2500)
    const after7d = (await getUser(fx.wholesaler.userId)).reliabilityScore
    const pen7d = await penaltyCount(fx.wholesaler.userId, fx.dealId)
    const missed72 = await db.collection('penalties').countDocuments({
      userId: oid(fx.wholesaler.userId), dealId: oid(fx.dealId), violationType: 'MISSED_72HR_DEADLINE',
    })
    if (after7d === afterTwo && pen7d === pen2) {
      pass(`7-day realtor job does not re-penalise an already kill-switched deal (score ${after7d})`)
    } else {
      fail('7-day realtor stacking', `extra penalty on same missed-proof: score ${afterTwo} → ${after7d}, penalties ${pen2} → ${pen7d}, MISSED_72HR_DEADLINE rows=${missed72}. handle7dayRealtor() reuses MISSED_72HR_DEADLINE and has no guard.`)
    }
  } catch (e) { fail('72hr / 7-day suite', e.message) }

  // ── C: 72hr with proof uploaded in time → no penalty ─────────────────────
  try {
    const fx = await createDealFixture(redis, stamp + 1000)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    db = mongoose.connection.db
    await db.collection('deals').updateOne(
      { _id: oid(fx.dealId) },
      { $set: { marketingProofDeadline: new Date(Date.now() - 3600_000), marketingProofUploaded: true, killSwitchFired: false } },
    )
    const before = (await getUser(fx.wholesaler.userId)).reliabilityScore
    await killQ.add('check-72hr-deadline', { dealId: fx.dealId }, { jobId: `t-72ok-${stamp}` })
    await sleep(2500)
    const after = (await getUser(fx.wholesaler.userId)).reliabilityScore
    const d = await getDeal(fx.dealId)
    if (after === before && !d.killSwitchFired && (await penaltyCount(fx.wholesaler.userId, fx.dealId)) === 0) {
      pass('72hr check: proof uploaded in time → no penalty, no kill switch')
    } else {
      fail('72hr check with proof', `score ${before} → ${after}, killSwitchFired=${d.killSwitchFired}`)
    }
  } catch (e) { fail('72hr-with-proof', e.message) }

  // ── E/F: backup activation — promote, then retry the job ─────────────────
  try {
    const fx = await createDealFixture(redis, stamp + 2000)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    db = mongoose.connection.db

    // Fabricate a backup-3 bid + wire it onto the deal, mark buyerFailed.
    const backupBuyer = oid('0000000000000000000000b3')
    const backupBid = (await db.collection('bids').insertOne({
      listingId: oid(fx.listingId), buyerId: backupBuyer, status: 'backup_3',
      assignmentPrice: 14000, backupPosition: 2, createdAt: new Date(), updatedAt: new Date(),
    })).insertedId
    await db.collection('deals').updateOne({ _id: oid(fx.dealId) }, { $set: {
      buyerFailed: true, backup3BidId: backupBid, backup3BuyerId: backupBuyer,
      backup2BidId: null, backup2BuyerId: null,
      backupActivationDeadline: new Date(Date.now() - 3600_000),
    } })

    await killQ.add('check-backup-activation', { dealId: fx.dealId }, { jobId: `t-bk-${stamp}` })
    const promoted = await waitFor(async () => {
      const d = await getDeal(fx.dealId)
      return String(d.primaryBidId) === String(backupBid)
    })
    const dAfter = await getDeal(fx.dealId)
    if (promoted && String(dAfter.primaryBuyerId) === String(backupBuyer)) {
      pass('backup activation: backup #3 promoted to primary')
    } else {
      fail('backup activation promote', `primaryBidId=${dAfter.primaryBidId} primaryBuyerId=${dAfter.primaryBuyerId}`)
    }

    // Retry the same job. backup3BidId is now null → the else-branch runs.
    await killQ.add('check-backup-activation', { dealId: fx.dealId }, { jobId: `t-bkr-${stamp}` })
    await sleep(2500)
    const listing = await db.collection('listings').findOne({ _id: oid(fx.listingId) })
    const dRetry = await getDeal(fx.dealId)
    if (listing.status !== 'cancelled' && String(dRetry.primaryBidId) === String(backupBid)) {
      pass('backup activation is idempotent on retry (live deal not cancelled)')
    } else {
      fail('backup activation retry', `RETRY CANCELLED A LIVE DEAL: listing.status=${listing.status}, deal.primaryBidId=${dRetry.primaryBidId}. handleBackupActivation() else-branch has no guard for "already promoted".`)
    }
  } catch (e) { fail('backup-activation suite', e.message) }

  // ── G: 30-day inactivity ────────────────────────────────────────────────
  try {
    const fx = await createDealFixture(redis, stamp + 3000)
    if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGODB_URI)
    db = mongoose.connection.db

    // stale user → restricted
    await db.collection('users').updateOne({ _id: oid(fx.buyer.userId) },
      { $set: { lastActiveAt: new Date(Date.now() - 40 * 864e5) }, $unset: { scoreRestrictedUntil: '' } })
    await actQ.add('check-30day-inactivity', { userId: fx.buyer.userId }, { jobId: `t-30-${stamp}` })
    const restricted = await waitFor(async () => Boolean((await getUser(fx.buyer.userId)).scoreRestrictedUntil))
    if (restricted) pass('30-day inactivity: stale user gets scoreRestrictedUntil set')
    else fail('30-day inactivity stale', 'scoreRestrictedUntil not set')

    // active user → not restricted
    await db.collection('users').updateOne({ _id: oid(fx.wholesaler.userId) },
      { $set: { lastActiveAt: new Date() }, $unset: { scoreRestrictedUntil: '' } })
    await actQ.add('check-30day-inactivity', { userId: fx.wholesaler.userId }, { jobId: `t-30a-${stamp}` })
    await sleep(2500)
    if (!(await getUser(fx.wholesaler.userId)).scoreRestrictedUntil) {
      pass('30-day inactivity: recently-active user is not restricted')
    } else {
      fail('30-day inactivity active', 'active user was wrongly restricted')
    }
  } catch (e) { fail('30-day-inactivity suite', e.message) }

  await killQ.close(); await actQ.close()
  await redis.quit(); await mongoose.disconnect()

  const p = results.filter((r) => r.ok).length
  console.log(`\n${'─'.repeat(60)}\nPassed: ${p} | Failed: ${results.length - p} (of ${results.length})`)
  process.exit(results.length - p > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
