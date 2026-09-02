#!/usr/bin/env node
/**
 * Measures event-loop impact of bcryptjs password hashing under load.
 *
 * bcryptjs is pure JS. Its async API time-slices with setImmediate so a single
 * hash doesn't fully freeze the loop, but ALL work still runs on the main
 * thread — N concurrent logins serialise and inflate the latency of every
 * other request in flight. Native `bcrypt` offloads to the libuv threadpool.
 *
 * This script:
 *   1. times a single cost-12 hash in pure JS
 *   2. baselines a trivial endpoint's latency
 *   3. fires a storm of concurrent /auth/login (each = one cost-12 compare)
 *      and re-measures the trivial endpoint DURING the storm
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import bcrypt from 'bcryptjs'
import { performance } from 'perf_hooks'
import { API, api, registerUser, createRedis } from './qa-lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const STORM = Number(process.argv[2] ?? 25) // concurrent logins
const PROBES = 30 // trivial-endpoint probes per phase

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const stats = (arr) => ({
  n: arr.length,
  min: +Math.min(...arr).toFixed(1),
  p50: +pct(arr, 50).toFixed(1),
  p95: +pct(arr, 95).toFixed(1),
  p99: +pct(arr, 99).toFixed(1),
  max: +Math.max(...arr).toFixed(1),
})

async function timeTrivial() {
  const t = performance.now()
  await fetch(`${API}/`).catch(() => {})
  return performance.now() - t
}

async function probeLoop(durationMs, out) {
  const end = performance.now() + durationMs
  while (performance.now() < end) {
    out.push(await timeTrivial())
  }
}

async function main() {
  const redis = createRedis()

  // 1 ── single hash cost
  const hashTimes = []
  for (let i = 0; i < 5; i++) {
    const t = performance.now()
    await bcrypt.hash(`pw-${i}-${Date.now()}`, 12)
    hashTimes.push(performance.now() - t)
  }
  console.log(`\n① single bcryptjs cost-12 hash (in-process): ${stats(hashTimes).p50} ms p50, ${stats(hashTimes).max} ms max`)

  // 2 ── baseline trivial latency (server idle)
  const base = []
  for (let i = 0; i < PROBES; i++) base.push(await timeTrivial())
  console.log(`\n② GET ${API}/ — server idle:`)
  console.table(stats(base))

  // 3 ── register a user we can log in as
  const stamp = Date.now()
  const u = await registerUser(redis, 'buyer', stamp, 0)
  const creds = JSON.stringify({ email: u.email, password: u.password })

  // warm one login (sends OTP; we only care about the bcrypt.compare cost)
  await api('/auth/login', { method: 'POST', body: creds })

  // 4 ── storm: N concurrent logins + probe the trivial endpoint during it
  console.log(`\n③ firing ${STORM} concurrent POST /auth/login (each = one cost-N bcrypt.compare)…`)
  const during = []
  const stormStart = performance.now()
  const storm = Promise.all(
    Array.from({ length: STORM }, async () => {
      const t = performance.now()
      const r = await api('/auth/login', { method: 'POST', body: creds })
      return { ms: performance.now() - t, status: r.status }
    }),
  )
  const probe = probeLoop(3000, during)
  const [stormRes] = await Promise.all([storm, probe])
  const stormWall = performance.now() - stormStart

  const loginMs = stormRes.map((r) => r.ms)
  const codes = stormRes.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {})

  console.log(`\n   /auth/login latency under storm (statuses ${JSON.stringify(codes)}):`)
  console.table(stats(loginMs))
  console.log(`   storm wall-clock for ${STORM} logins: ${stormWall.toFixed(0)} ms  (~${(stormWall / STORM).toFixed(0)} ms/login serialised)`)

  console.log(`\n④ GET ${API}/ latency DURING the login storm:`)
  console.table(stats(during))

  const b = stats(base), d = stats(during)
  const infl95 = (d.p95 / Math.max(b.p95, 0.1)).toFixed(1)
  const infl99 = (d.p99 / Math.max(b.p99, 0.1)).toFixed(1)
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Trivial-endpoint p95 inflation under bcrypt storm: ${b.p95}ms → ${d.p95}ms  (${infl95}×)`)
  console.log(`Trivial-endpoint p99 inflation under bcrypt storm: ${b.p99}ms → ${d.p99}ms  (${infl99}×)`)
  console.log(`Interpretation: >2× inflation ⇒ hashing is contending on the main thread.`)

  await redis.quit().catch(() => {})
}

main().catch((e) => { console.error(e); process.exit(1) })
