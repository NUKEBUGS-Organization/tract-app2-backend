/* eslint-disable no-console */
import { existsSync, readFileSync } from 'fs'
import { MongoClient } from 'mongodb'
import { v2 as cloudinary } from 'cloudinary'
import {
  createTransactionResetPlan,
  dbNameFromMongoUri,
  executeTransactionReset,
  type CloudinaryAsset,
} from '../src/maintenance/transaction-reset'

function loadLocalEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')
    if (key && process.env[key] === undefined) process.env[key] = value
  }
}

function parseArgs(argv: string[]) {
  return {
    execute: argv.includes('--execute'),
    dryRun: argv.includes('--dry-run') || !argv.includes('--execute'),
    skipUploadCleanup: argv.includes('--skip-upload-cleanup'),
  }
}

async function deleteUploads(uploads: CloudinaryAsset[]) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  })
  const results: Array<{ publicId: string; resourceType: string; ok: boolean; error?: string }> = []
  for (const upload of uploads) {
    try {
      await cloudinary.uploader.destroy(upload.publicId, { resource_type: upload.resourceType })
      results.push({ publicId: upload.publicId, resourceType: upload.resourceType, ok: true })
    } catch (err) {
      results.push({
        publicId: upload.publicId,
        resourceType: upload.resourceType,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return results
}

async function main() {
  loadLocalEnv()
  const args = parseArgs(process.argv.slice(2))
  if (args.execute && args.dryRun && process.argv.includes('--dry-run')) {
    throw new Error('Use either --dry-run or --execute, not both.')
  }
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) throw new Error('MONGODB_URI is required.')
  const dbName = dbNameFromMongoUri(uri)
  const expected = process.env.RESET_EXPECTED_DB?.trim()
  if (expected && expected !== dbName) {
    throw new Error(`Configured database "${dbName}" does not match RESET_EXPECTED_DB="${expected}".`)
  }

  const client = new MongoClient(uri)
  await client.connect()
  try {
    const db = client.db(dbName)
    const plan = await createTransactionResetPlan(db, { cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME })
    console.log(JSON.stringify({ mode: args.execute ? 'execute' : 'dry-run', plan }, null, 2))
    const result = await executeTransactionReset(db, plan, { execute: args.execute })
    let uploadCleanup: unknown = { skipped: true, reason: args.execute ? 'disabled' : 'dry-run' }
    if (args.execute && !args.skipUploadCleanup) {
      uploadCleanup = await deleteUploads(plan.uploads)
    }
    console.log(JSON.stringify({ ...result, uploadCleanup }, null, 2))
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
