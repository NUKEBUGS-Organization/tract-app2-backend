/**
 * Fix E11000 on users.googleId_1 when registering password users.
 *
 * Root cause: unique index on googleId indexes null, so only one user without
 * Google can exist. Unset null/empty googleId and recreate as a partial unique
 * index (string values only).
 *
 * Usage:
 *   DRY_RUN=1 MONGODB_URI=... node scripts/fix-googleId-unique-index.js
 *   MONGODB_URI=... node scripts/fix-googleId-unique-index.js
 *
 * Also runs automatically on API boot via UsersService.onModuleInit.
 */
/* eslint-disable no-console */

const { MongoClient } = require('mongodb')

const URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb://localhost:27017/tract'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  const db = client.db()
  const users = db.collection('users')

  const nullCount = await users.countDocuments({
    $or: [{ googleId: null }, { googleId: '' }],
  })
  console.log(`Users with null/empty googleId: ${nullCount}`)

  if (!DRY_RUN && nullCount > 0) {
    const res = await users.updateMany(
      { $or: [{ googleId: null }, { googleId: '' }] },
      { $unset: { googleId: '' } },
    )
    console.log(`Unset googleId on ${res.modifiedCount} document(s)`)
  }

  const indexes = await users.indexes()
  const existing = indexes.find((idx) => idx.name === 'googleId_1')
  console.log('Current googleId_1:', JSON.stringify(existing || null))

  const wantsPartial =
    existing?.unique === true &&
    existing?.partialFilterExpression?.googleId?.$type === 'string'

  if (DRY_RUN) {
    console.log(
      wantsPartial
        ? 'DRY_RUN: index already correct'
        : 'DRY_RUN: would drop/recreate googleId_1 as partial unique',
    )
    await client.close()
    return
  }

  if (existing && !wantsPartial) {
    await users.dropIndex('googleId_1')
    console.log('Dropped googleId_1')
  }

  if (!wantsPartial) {
    await users.createIndex(
      { googleId: 1 },
      {
        unique: true,
        name: 'googleId_1',
        partialFilterExpression: { googleId: { $type: 'string' } },
      },
    )
    console.log('Created partial unique googleId_1')
  } else {
    console.log('Index already correct — nothing to do')
  }

  await client.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
