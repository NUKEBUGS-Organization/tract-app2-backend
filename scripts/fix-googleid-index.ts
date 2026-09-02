/**
 * Fix googleId unique index — non-sparse index blocks multiple email/password signups (googleId: null).
 * Run once: npx ts-node -r tsconfig-paths/register scripts/fix-googleid-index.ts
 */
import 'dotenv/config'
import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI?.trim()
if (!MONGODB_URI) {
  console.error('MONGODB_URI required')
  process.exit(1)
}

async function main() {
  await mongoose.connect(MONGODB_URI!)
  const col = mongoose.connection.db!.collection('users')

  const indexes = await col.indexes()
  console.log('Current indexes on googleId:', indexes.filter((i) => i.key?.googleId))

  for (const idx of indexes) {
    if (idx.key?.googleId === 1) {
      const name = idx.name ?? 'googleId_1'
      console.log(`Dropping index ${name} (sparse=${idx.sparse ?? false})...`)
      await col.dropIndex(name)
    }
  }

  await col.createIndex({ googleId: 1 }, { unique: true, sparse: true })
  console.log('✅ googleId sparse unique index ready')
  console.log('Final:', (await col.indexes()).filter((i) => i.key?.googleId))
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
