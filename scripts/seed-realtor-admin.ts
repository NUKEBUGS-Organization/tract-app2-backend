/**
 * Seed two shared-users accounts:
 *   - realtor  → for App 2 (Marketplace)
 *   - admin    → for App 1 (Acquisition / seller admin)
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-realtor-admin.ts
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

type SeedUser = {
  fullName: string
  email: string
  phone: string
  password: string
  role: 'realtor' | 'admin'
  stateCode: string
}

const SEED_USERS: SeedUser[] = [
  {
    fullName: 'Qaiser Waheed',
    email: 'qaiserwaheed00@gmail.com',
    phone: '+17019976601',
    password: 'Test1234!',
    role: 'realtor',
    stateCode: 'TX',
  },
  {
    fullName: 'Wasif Zahoor',
    email: 'wasifzahoor296@gmail.com',
    phone: '+19995550199',
    password: 'admin1234!',
    role: 'admin',
    stateCode: 'TX',
  },
  {
    fullName: 'Mano Admin',
    email: 'mano162888@gmail.com',
    phone: '+19995550200',
    password: 'mano@Admin',
    role: 'admin',
    stateCode: 'TX',
  },
]

function buildUserDoc(seed: SeedUser, passwordHash: string) {
  const now = new Date()
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
    pofStatus: 'not_submitted',
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
    licenseNumber: seed.role === 'realtor' ? 'RE-TEST-001' : '',
    brokerageName: seed.role === 'realtor' ? 'TRACT Test Brokerage' : '',
    managingBroker: '',
    officeAddress: '',
    commissionPct: seed.role === 'realtor' ? 3 : 0,
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
    app2_isVettedBuyer: false,
    app2_vettedAt: null,
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
  console.log(`Connecting…`)
  await mongoose.connect(MONGODB_URI)
  const users = mongoose.connection.db!.collection('users')

  for (const seed of SEED_USERS) {
    const email = seed.email.toLowerCase().trim()
    const passwordHash = await bcrypt.hash(seed.password, BCRYPT_ROUNDS)

    await users.deleteMany({ email })
    await users.deleteMany({ phone: seed.phone })

    await users.insertOne(buildUserDoc(seed, passwordHash))
    console.log(`✅ ${email} (${seed.role}) — password set`)
  }

  // Remove old App1 admin if still present
  const removed = await users.deleteMany({ email: 'selleradmin@gmail.com' })
  if (removed.deletedCount) {
    console.log(`🗑️  Removed selleradmin@gmail.com (${removed.deletedCount})`)
  }

  await mongoose.disconnect()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
