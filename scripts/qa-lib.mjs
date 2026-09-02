/**
 * Shared helpers for QA / security / chat scripts.
 */
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import Redis from 'ioredis'
import mongoose from 'mongoose'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

export const API = (process.env.QA_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '')
export const API_ROOT = API.replace(/\/api\/v1$/, '')
export const TEST_OTP = process.env.TEST_OTP_CODE ?? '123456'

export function auth(token) {
  return { Authorization: `Bearer ${token}` }
}

export async function api(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, ok: res.ok }
}

export function uniquePhone(stamp, offset = 0) {
  return `+1${String(stamp + offset).slice(-10).padStart(10, '0')}`
}

export async function readEmailOtp(redis, emailKey) {
  const code = await redis.get(`otp:email:${emailKey}`)
  if (!code) throw new Error(`OTP missing for otp:email:${emailKey}`)
  return code
}

export async function registerUser(redis, role, stamp, offset = 0) {
  const email = `qa_${role}_${stamp + offset}@test.com`
  const phone = uniquePhone(stamp, offset)
  const password = 'Password1'

  let res = await api('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) })
  if (!res.ok) throw new Error(`send-otp failed: ${res.status}`)

  const emailOtp = await readEmailOtp(redis, email.toLowerCase())
  res = await api('/auth/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ email, emailOtp }),
  })
  if (!res.ok) throw new Error(`verify-otp failed: ${res.status}`)

  res = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `QA ${role}`,
      email,
      phone,
      password,
      role,
      dob: '1990-01-01',
      stateCode: 'TX',
    }),
  })
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`)

  return {
    email,
    password,
    accessToken: res.body.data.accessToken,
    userId: res.body.data.user.id ?? res.body.data.user._id,
  }
}

export async function loginUser(redis, email, password, useBypass = false) {
  let res = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)

  const normalized = email.toLowerCase().trim()
  let loginOtp = useBypass ? TEST_OTP : await readEmailOtp(redis, `login:${normalized}`)

  res = await api('/auth/verify-login-otp', {
    method: 'POST',
    body: JSON.stringify({ email: normalized, otp: loginOtp }),
  })
  if (!res.ok && !useBypass) {
    loginOtp = await readEmailOtp(redis, `login:${normalized}`)
    res = await api('/auth/verify-login-otp', {
      method: 'POST',
      body: JSON.stringify({ email: normalized, otp: loginOtp }),
    })
  }
  if (!res.ok) throw new Error(`verify-login-otp failed: ${res.status}`)

  return res.body.data.accessToken
}

export async function seedSignedContract({ listingId, bidId, wholesalerId, buyerId, assignmentFee }) {
  await mongoose.connect(process.env.MONGODB_URI)
  const contracts = mongoose.connection.db.collection('contracts')
  const now = new Date()
  await contracts.deleteMany({ bidId: new mongoose.Types.ObjectId(bidId) })
  const { insertedId } = await contracts.insertOne({
    listingId: new mongoose.Types.ObjectId(listingId),
    bidId: new mongoose.Types.ObjectId(bidId),
    wholesalerId: new mongoose.Types.ObjectId(wholesalerId),
    buyerId: new mongoose.Types.ObjectId(buyerId),
    status: 'signed',
    assignmentFeeFinal: assignmentFee,
    pdfUrl: 'https://example.com/qa-contract.pdf',
    wholesalerSignedAt: now,
    buyerSignedAt: now,
    createdAt: now,
    updatedAt: now,
  })
  await mongoose.disconnect()
  return insertedId.toString()
}

/** Minimal live listing + bid + signed contract + deal for chat / vault tests. */
export async function createDealFixture(redis, stamp) {
  const buyer = await registerUser(redis, 'buyer', stamp, 1)
  const wholesaler = await registerUser(redis, 'wholesaler', stamp, 2)
  const adminToken = await loginUser(redis, 'wasifzahoor296@gmail.com', 'admin1234!', false)

  let res = await api('/listings', {
    method: 'POST',
    headers: auth(wholesaler.accessToken),
    body: JSON.stringify({ dealType: 'fix_flip', marketStatus: 'off_market' }),
  })
  if (res.status !== 201) throw new Error(`create listing ${res.status}`)
  const listingId = res.body.data._id

  res = await api(`/listings/${listingId}`, {
    method: 'PATCH',
    headers: auth(wholesaler.accessToken),
    body: JSON.stringify({
      propertyAddress: `QA Chat St ${stamp}`,
      city: 'Dallas',
      stateCode: 'TX',
      zipCode: '75201',
      arv: 400000,
      rehabTotal: 60000,
      purchasePrice: 280000,
      assignmentFeeLow: 12000,
      assignmentFeeHigh: 18000,
      estimatedHoldingCosts: 6000,
    }),
  })
  if (!res.ok) throw new Error(`patch listing ${res.status}`)

  res = await api(`/listings/${listingId}/publish`, {
    method: 'POST',
    headers: auth(wholesaler.accessToken),
  })
  if (!res.ok) throw new Error(`publish ${res.status}`)

  res = await api(`/admin/listings/${listingId}/review`, {
    method: 'POST',
    headers: auth(adminToken),
    body: JSON.stringify({ action: 'approve' }),
  })
  if (!res.ok) throw new Error(`approve listing ${res.status}`)

  res = await api('/bids', {
    method: 'POST',
    headers: auth(buyer.accessToken),
    body: JSON.stringify({ listingId, assignmentPrice: 15000 }),
  })
  if (res.status !== 201) throw new Error(`place bid ${res.status}`)
  const bidId = res.body.data._id

  res = await api(`/bids/listing/${listingId}/select`, {
    method: 'POST',
    headers: auth(wholesaler.accessToken),
    body: JSON.stringify({ primaryBidId: bidId }),
  })
  if (!res.ok) throw new Error(`select bid ${res.status}`)

  await seedSignedContract({
    listingId,
    bidId,
    wholesalerId: wholesaler.userId,
    buyerId: buyer.userId,
    assignmentFee: 15000,
  })

  res = await api('/deals', {
    method: 'POST',
    headers: auth(wholesaler.accessToken),
    body: JSON.stringify({
      listingId,
      primaryBidId: bidId,
      primaryBuyerId: buyer.userId,
      wholesalerId: wholesaler.userId,
      emdAmount: 1500,
    }),
  })
  if (!res.ok) throw new Error(`create deal ${res.status}`)
  const dealId = res.body.data._id

  return { buyer, wholesaler, adminToken, listingId, bidId, dealId }
}

export function createRedis() {
  return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')
}
