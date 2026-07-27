/**
 * Upsert placeholder title companies.
 * Usage: npx ts-node -r dotenv/config scripts/seed-title-companies.ts
 */
import mongoose from 'mongoose'
import * as dotenv from 'dotenv'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI ?? ''

const SEED = [
  {
    name: 'First American Title',
    contactEmail: 'closings@firstam.com',
    phone: '+1 (800) 854-3643',
  },
  {
    name: 'Stewart Title',
    contactEmail: 'closings@stewart.com',
    phone: '+1 (800) 729-1900',
  },
  {
    name: 'Old Republic Title',
    contactEmail: 'closings@oldrepublictitle.com',
    phone: '+1 (800) 445-4500',
  },
  {
    name: 'Chicago Title',
    contactEmail: 'closings@ctic.com',
    phone: '+1 (312) 223-2000',
  },
  {
    name: 'Fidelity National Title',
    contactEmail: 'closings@fnf.com',
    phone: '+1 (888) 934-3354',
  },
]

async function main() {
  if (!MONGODB_URI) throw new Error('MONGODB_URI required')
  await mongoose.connect(MONGODB_URI)
  const col = mongoose.connection.collection('title_companies')

  for (const row of SEED) {
    await col.updateOne(
      { name: row.name },
      {
        $set: {
          contactEmail: row.contactEmail.toLowerCase(),
          phone: row.phone,
          active: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          name: row.name,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    )
    console.log('upserted', row.name)
  }

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
