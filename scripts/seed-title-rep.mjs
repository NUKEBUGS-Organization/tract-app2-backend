/**
 * Seed / upsert a title_rep user for App2 deal assignment.
 * Usage: node scripts/seed-title-rep.mjs
 */
import dns from 'dns'
dns.setServers(['8.8.8.8', '1.1.1.1'])

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const MONGODB_URI =
  process.env.MONGODB_URI?.trim() ||
  'mongodb+srv://tract:Tract123@cluster0.ly7hqwa.mongodb.net/tract?appName=Cluster0'

const BCRYPT_ROUNDS = 12

const SEED = {
  fullName: 'Malik Saif Title Rep',
  email: 'maliksaifnew@gmail.com',
  phone: '+15551234901',
  password: 'Test1234!',
  role: 'title_rep',
  stateCode: 'TX',
}

async function main() {
  console.log('Connecting…')
  await mongoose.connect(MONGODB_URI)
  const users = mongoose.connection.db.collection('users')

  const email = SEED.email.toLowerCase().trim()
  const passwordHash = await bcrypt.hash(SEED.password, BCRYPT_ROUNDS)
  const now = new Date()

  const existing = await users.findOne({ email })

  const doc = {
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
    updatedAt: now,
  }

  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: { ...doc, createdAt: existing.createdAt ?? now },
        $unset: { password: '' },
      },
    )
    console.log(`Updated ${email} (title_rep)`)
  } else {
    const phoneTaken = await users.findOne({ phone: SEED.phone })
    if (phoneTaken) {
      doc.phone = `+1555${String(Date.now()).slice(-7)}`
      console.log(`Phone in use; using ${doc.phone}`)
    }
    await users.insertOne({ ...doc, createdAt: now })
    console.log(`Created ${email} (title_rep)`)
  }

  const verify = await users.findOne({ email })
  console.log(
    JSON.stringify(
      {
        id: verify?._id?.toString(),
        email: verify?.email,
        role: verify?.role,
        kycStatus: verify?.kycStatus,
        isBanned: verify?.isBanned,
        hasPasswordHash: Boolean(verify?.passwordHash),
      },
      null,
      2,
    ),
  )

  await mongoose.disconnect()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
