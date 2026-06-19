import mongoose from 'mongoose'
import * as bcrypt from 'bcryptjs'
import * as dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI ?? ''

type TestUser = {
  fullName: string
  email: string
  phone: string
  password: string
  role: string
  stateCode: string
  dob: Date
  kycStatus?: string
  bankVerified?: boolean
}

const TEST_USERS: TestUser[] = [
  {
    fullName: 'Test Wholesaler',
    email: 'azibaliansari311@gmail.com',
    phone: '+17326403465',
    password: 'Test1234!',
    role: 'wholesaler',
    stateCode: 'TX',
    dob: new Date('1988-03-15'),
    kycStatus: 'approved',
    bankVerified: true,
  },
  {
    fullName: 'Test Seller',
    email: 'qaiserwaheed00@gmail.com',
    phone: '+17019976600',
    password: 'Test1234!',
    role: 'seller',
    stateCode: 'TX',
    dob: new Date('1987-07-20'),
    kycStatus: 'approved',
  },
  {
    fullName: 'Test Realtor',
    email: 'hammadshahi468@gmail.com',
    phone: '+17759865200',
    password: 'Test1234!',
    role: 'realtor',
    stateCode: 'TX',
    dob: new Date('1986-11-10'),
    kycStatus: 'approved',
    bankVerified: true,
  },
  {
    fullName: 'Tract Admin',
    email: 'tractadminscore1@example.com',
    phone: '+19995550100',
    password: 'Admin1234!',
    role: 'admin',
    stateCode: 'TX',
    dob: new Date('1980-01-01'),
    kycStatus: 'approved',
    bankVerified: true,
  },
  {
    fullName: 'Test Buyer',
    email: 'buyer@tract-test.com',
    phone: '+13015550100',
    password: 'Test1234!',
    role: 'buyer',
    stateCode: 'TX',
    dob: new Date('1990-01-01'),
    kycStatus: 'approved',
  },
  {
    fullName: 'Title Rep',
    email: 'titlerep@tract-test.com',
    phone: '+12125550100',
    password: 'Test1234!',
    role: 'title_rep',
    stateCode: 'TX',
    dob: new Date('1985-06-15'),
    kycStatus: 'approved',
    bankVerified: true,
  },
]

function baseFields(user: TestUser, hashed: string) {
  return {
    fullName: user.fullName,
    email: user.email.toLowerCase().trim(),
    phone: user.phone,
    password: hashed,
    role: user.role,
    stateCode: user.stateCode,
    dob: user.dob,
    kycStatus: user.kycStatus ?? 'pending',
    bankVerified: user.bankVerified ?? false,
    reliabilityScore: 100,
    professionalScore: 100,
    isBanned: false,
    app2_activeDealsCount: 0,
    app2_totalDealsClosed: 0,
    app2_isVettedBuyer: false,
    app2_reactivationFeePending: false,
    app2_platformFeePaid: false,
    app2_totalPlatformFeesPaid: 0,
    lastActiveAt: new Date(),
    updatedAt: new Date(),
  }
}

async function seedUsers() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env')
    process.exit(1)
  }

  console.log('Connecting to MongoDB...')
  await mongoose.connect(MONGODB_URI)
  console.log('✅ Connected')

  const db = mongoose.connection.db
  if (!db) {
    console.error('❌ MongoDB connection has no database handle')
    await mongoose.disconnect()
    process.exit(1)
  }

  const collection = db.collection('users')

  for (const user of TEST_USERS) {
    const email = user.email.toLowerCase().trim()
    const hashed = await bcrypt.hash(user.password, 12)
    const existing = await collection.findOne({
      $or: [{ email }, { phone: user.phone }],
    })

    if (existing) {
      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...baseFields(user, hashed),
            createdAt: existing.createdAt ?? new Date(),
          },
        },
      )
      console.log(`✅ ${email} → ${user.password} (${user.role}) [updated]`)
      continue
    }

    await collection.insertOne({
      ...baseFields(user, hashed),
      createdAt: new Date(),
    })
    console.log(`✅ ${email} → ${user.password} (${user.role}) [created]`)
  }

  await mongoose.disconnect()
  console.log('✅ All test users seeded.')
}

seedUsers().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
