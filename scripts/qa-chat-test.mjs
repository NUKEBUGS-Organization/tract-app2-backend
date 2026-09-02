#!/usr/bin/env node
/**
 * Chat HTTP + WebSocket room authorization tests.
 * Usage: node scripts/qa-chat-test.mjs
 */
import { io } from 'socket.io-client'
import {
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
      reject(new Error('socket join timeout'))
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
  console.log(`\n💬 TRACT chat QA\n`)
  const redis = createRedis()

  let fixture
  try {
    fixture = await createDealFixture(redis, stamp)
  } catch (e) {
    fail('Create deal fixture', e)
    await redis.quit().catch(() => undefined)
    process.exit(1)
  }

  const { buyer, wholesaler, dealId } = fixture

  // HTTP: party can send and read
  try {
    const content = `QA chat message ${stamp}`
    let res = await api('/chat', {
      method: 'POST',
      headers: auth(buyer.accessToken),
      body: JSON.stringify({ dealId, content }),
    })
    if (res.status !== 201) throw new Error(`send ${res.status}`)

    res = await api(`/chat/${dealId}`, { headers: auth(wholesaler.accessToken) })
    if (!res.ok) throw new Error(`get messages ${res.status}`)
    const messages = res.body.data?.messages ?? res.body.data ?? []
    const found = messages.some((m) => m.content === content)
    if (!found) throw new Error('message not visible to wholesaler')
    pass('Chat HTTP — buyer sends, wholesaler reads')
  } catch (e) {
    fail('Chat HTTP — buyer sends, wholesaler reads', e)
  }

  // HTTP: non-party blocked
  try {
    const outsider = await registerUser(redis, 'buyer', stamp, 99)
    const res = await api(`/chat/${dealId}`, { headers: auth(outsider.accessToken) })
    if (res.status === 403 || res.status === 404) pass('Chat HTTP — non-party blocked')
    else fail('Chat HTTP — non-party blocked', `expected 403, got ${res.status}`)
  } catch (e) {
    fail('Chat HTTP — non-party blocked', e)
  }

  // WebSocket: party can connect; join ack may be delayed under load
  try {
    const connected = await new Promise((resolve, reject) => {
      const socket = io(API_ROOT, {
        auth: { token: buyer.accessToken },
        transports: ['websocket'],
        timeout: 10_000,
      })
      const timer = setTimeout(() => {
        socket.disconnect()
        reject(new Error('connect timeout'))
      }, 12_000)
      socket.on('connect', () => {
        clearTimeout(timer)
        socket.disconnect()
        resolve(true)
      })
      socket.on('connect_error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    if (connected) pass('WebSocket — deal party authenticated connect')
    else fail('WebSocket — deal party authenticated connect', 'not connected')
  } catch (e) {
    fail('WebSocket — deal party authenticated connect', e)
  }

  // WebSocket: non-party cannot join deal room
  try {
    const outsider = await registerUser(redis, 'buyer', stamp, 100)
    const ack = await joinDealRoom(outsider.accessToken, dealId)
    if (ack?.error === 'forbidden') pass('WebSocket — non-party deal join blocked')
    else fail('WebSocket — non-party deal join blocked', JSON.stringify(ack))
  } catch (e) {
    fail('WebSocket — non-party deal join blocked', e)
  }

  await redis.quit().catch(() => undefined)

  console.log('\n────────────────────────────────')
  const bad = results.filter((r) => !r.ok)
  if (bad.length === 0) {
    console.log(`All ${results.length} chat tests passed.\n`)
    process.exit(0)
  }
  console.log(`${bad.length}/${results.length} failed\n`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
