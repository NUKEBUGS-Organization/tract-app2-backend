import mongoose from 'mongoose'
import * as bcrypt from 'bcryptjs'
import * as dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI ?? ''

const ACCOUNTS = [
  {
    email: 'azibaliansari311@gmail.com',
    password: 'Test1234!',
  },
  {
    email: 'qaiserwaheed00@gmail.com',
    password: 'Test1234!',
  },
  {
    email: 'hammadshahi468@gmail.com',
    password: 'Test1234!',
  },
]

const NEW_BUYER = {
  fullName: 'Test Buyer',
  email: 'buyer@tract-test.com',
  phone: '+13015550100',
  password: 'Test1234!',
  role: 'buyer' as const,
  stateCode: 'TX',
  dob: new Date('1990-01-01'),
}

async function seedPassword() {
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

  for (const account of ACCOUNTS) {
    const user = await collection.findOne({
      email: account.email.toLowerCase().trim(),
    })

    if (!user) {
      console.warn(`⚠ Not found: ${account.email}`)
      continue
    }

    const hashed = await bcrypt.hash(account.password, 12)

    await collection.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashed,
          refreshToken: null,
        },
      },
    )

    console.log(
      `✅ ${account.email} → ${account.password} (${user.role})`,
    )
  }

  await mongoose.disconnect()
  console.log('✅ All accounts updated.')
}

async function createUser() {
  if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not set in .env')
    process.exit(1)
  }

  await mongoose.connect(MONGODB_URI)
  const collection = mongoose.connection.db!.collection('users')

  const email = NEW_BUYER.email.toLowerCase().trim()
  const exists = await collection.findOne({
    $or: [{ email }, { phone: NEW_BUYER.phone }],
  })

  if (exists) {
    console.log(`⚠ Buyer already exists (${exists.email})`)
    await mongoose.disconnect()
    return
  }

  const hashed = await bcrypt.hash(NEW_BUYER.password, 12)

  await collection.insertOne({
    ...NEW_BUYER,
    email,
    password: hashed,
    kycStatus: 'pending',
    bankVerified: false,
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
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  console.log('✅ Buyer created: buyer@tract-test.com / Test1234!')
  await mongoose.disconnect()
}

async function main() {
  await seedPassword()
  await createUser()
}

main().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
