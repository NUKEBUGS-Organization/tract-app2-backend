/**
 * Seed TRACT QA accounts (shared users collection).
 * Password for all: TractTesting123
 * Login OTP is skipped in AuthService for these emails.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-tractcorp-test.ts
 *   npm run seed:tractcorp-test
 */
import dns from 'dns'
dns.setServers(['8.8.8.8', '1.1.1.1'])

import 'dotenv/config'
import mongoose from 'mongoose'
import * as bcrypt from 'bcryptjs'

const MONGODB_URI =
  process.env.MONGODB_URI?.trim() ||
  'mongodb+srv://tract:Tract123@cluster0.ly7hqwa.mongodb.net/tract?appName=Cluster0'

const BCRYPT_ROUNDS = 12
const PASSWORD = 'TractTesting123'

type SeedRole = 'realtor' | 'buyer' | 'seller' | 'wholesaler' | 'admin'

type SeedUser = {
  fullName: string
  email: string
  phone: string
  role: SeedRole
  stateCode: string
}

/** Keep phones unique — shared users collection enforces unique phone. */
export const TRACTCORP_TEST_USERS: SeedUser[] = [
  {
    fullName: 'TRACT Realtor',
    email: 'realtor@tractcorp.com',
    phone: '+15550001001',
    role: 'realtor',
    stateCode: 'TX',
  },
  {
    fullName: 'TRACT Buyer',
    email: 'buyer@tractcorp.com',
    phone: '+15550001002',
    role: 'buyer',
    stateCode: 'TX',
  },
  {
    fullName: 'TRACT Seller',
    email: 'seller@tractcorp.com',
    phone: '+15550001003',
    role: 'seller',
    stateCode: 'TX',
  },
  {
    fullName: 'TRACT Wholesaler',
    email: 'wholesaler@tractcorp.com',
    phone: '+15550001004',
    role: 'wholesaler',
    stateCode: 'TX',
  },
  {
    fullName: 'TRACT Admin',
    email: 'admin@tractcorp.com',
    phone: '+15550001005',
    role: 'admin',
    stateCode: 'TX',
  },
]

export const TRACTCORP_TEST_EMAILS = TRACTCORP_TEST_USERS.map((u) => u.email.toLowerCase())

function buildUserDoc(seed: SeedUser, passwordHash: string) {
  const now = new Date()
  const isRealtor = seed.role === 'realtor'
  const isBuyer = seed.role === 'buyer'
  return {
    fullName: seed.fullName,
    email: seed.email.toLowerCase().trim(),
    phone: seed.phone,
    passwordHash,
    role: seed.role,
    stateCode: seed.stateCode,
    dob: new Date('1990-01-01T00:00:00.000Z'),
    kycStatus: 'approved',
    kycVerifiedAt: now,
    kycProvider: null,
    bankVerified: true,
    bankVerifiedAt: now,
    bankProvider: null,
    pofStatus: isBuyer ? 'approved' : 'not_submitted',
    pofApprovedAt: isBuyer ? now : null,
    reliabilityScore: 100,
    professionalScore: 100,
    restrictionStatus: 'normal',
    scoreRestrictedUntil: null,
    isBanned: false,
    banReason: null,
    banExpiresAt: null,
    lastActiveAt: now,
    currentSessionId: null,
    deletedAt: null,
    licenseNumber: isRealtor ? 'RE-TRACTCORP-001' : '',
    brokerageName: isRealtor ? 'TRACT Test Brokerage' : '',
    managingBroker: '',
    officeAddress: '',
    commissionPct: isRealtor ? 3 : 0,
    defaultAgencyRole: null,
    defaultFeePaidBy: null,
    proofOfActivityUrl: null,
    proofOfActivityUploadedAt: null,
    linkedInUrl: '',
    app1_inRestrictedState: false,
    app1_activeDealsCount: 0,
    app1_totalDealsClosed: 0,
    app1_lastContractSecuredAt: null,
    app1_maxActiveDeals: 1,
    app1_reactivationFeePending: false,
    app1_platformFeePaid: false,
    app1_totalPlatformFeesPaid: 0,
    app1_linkedUserId: null,
    app2_isVettedBuyer: isBuyer,
    app2_vettedAt: isBuyer ? now : null,
    app2_activeDealsCount: 0,
    app2_totalDealsClosed: 0,
    app2_lastContractSecuredAt: null,
    app2_reactivationFeePending: false,
    app2_platformFeePaid: false,
    app2_totalPlatformFeesPaid: 0,
    createdAt: now,
    updatedAt: now,
  }
}

async function main() {
  console.log('Connecting…')
  await mongoose.connect(MONGODB_URI)
  const users = mongoose.connection.db!.collection('users')
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS)

  for (const seed of TRACTCORP_TEST_USERS) {
    const email = seed.email.toLowerCase().trim()
    await users.deleteMany({ email })
    await users.deleteMany({ phone: seed.phone })
    await users.insertOne(buildUserDoc(seed, passwordHash))
    console.log(`✅ ${email} (${seed.role})`)
  }

  console.log(`Password for all: ${PASSWORD}`)
  console.log('OTP is skipped for these emails on password login.')
  await mongoose.disconnect()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
