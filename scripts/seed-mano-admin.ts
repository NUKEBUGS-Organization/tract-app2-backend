/**
 * Seed admin: mano162888@gmail.com / mano@Admin
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/seed-mano-admin.ts
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

const SEED = {
  fullName: 'Mano Admin',
  email: 'mano162888@gmail.com',
  phone: '+19995550200',
  password: 'mano@Admin',
  role: 'admin' as const,
  stateCode: 'TX',
}

async function main() {
  console.log('Connecting…')
  await mongoose.connect(MONGODB_URI)
  const users = mongoose.connection.db!.collection('users')

  const email = SEED.email.toLowerCase().trim()
  const passwordHash = await bcrypt.hash(SEED.password, BCRYPT_ROUNDS)
  const now = new Date()

  await users.deleteMany({ email })
  await users.deleteMany({ phone: SEED.phone })

  await users.insertOne({
    fullName: SEED.fullName,
    email,
    phone: SEED.phone,
    passwordHash,
    role: SEED.role,
    stateCode: SEED.stateCode,
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
    licenseNumber: '',
    brokerageName: '',
    managingBroker: '',
    officeAddress: '',
    commissionPct: 0,
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
  })

  const verify = await users.findOne({ email })
  const passwordOk = verify
    ? await bcrypt.compare(SEED.password, verify.passwordHash as string)
    : false

  console.log(`✅ ${email} (${SEED.role}) — passwordOk=${passwordOk}`)
  await mongoose.disconnect()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
