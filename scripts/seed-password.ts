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

seedPassword().catch((err) => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
