import mongoose from 'mongoose'
import type { Collection } from 'mongodb'
import * as dotenv from 'dotenv'
import {
  FAQ_CATEGORIES,
} from '../src/common/constants/faq-categories'

dotenv.config()

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env')
  process.exit(1)
}

// Validate all seed categories at startup
// before touching the DB
const VALID_CATEGORIES = new Set(FAQ_CATEGORIES)

function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

async function uniqueSlug(
  base: string,
  col: Collection,
  existingId?: string,
): Promise<string> {
  let slug = base
  let n = 2
  while (true) {
    const existing = await col.findOne({ slug })
    if (
      !existing ||
      existing._id.toString() === existingId
    ) {
      return slug
    }
    slug = `${base}-${n++}`
  }
}

const FAQ_ENTRIES = [
  // ── Account & Verification ──────────
  {
    question: 'Who can buy properties on Buy TRACT?',
    answer:
      'The platform is built for corporate entities, institutional buyers, and individual real estate investors looking for verified off-market inventory.',
    category: 'Account & Verification',
    order: 1,
    isPublished: true,
  },
  {
    question: 'Do I need to verify my proof of funds (POF)?',
    answer:
      'Yes. To maintain a secure marketplace and protect sellers, buyers must link a verified proof of funds, transactional funding capability, or a bank pre-approval letter before placing binding offers on active contracts.',
    category: 'Account & Verification',
    order: 2,
    isPublished: true,
  },
  // ── Transaction Fees & Payments ─────
  {
    question: 'What are the buyer fees on Buy TRACT?',
    answer:
      'Buy TRACT utilizes a competitive transaction-fee structure. Buyers pay a 1.5% Platform Utilization fee calculated based on the final contract purchase price.',
    category: 'Transaction Fees & Payments',
    order: 1,
    isPublished: true,
  },
  {
    question: 'When is the 1.5% fee paid?',
    answer:
      'Like the seller\'s side, this fee is strictly success-based. It is factored into the closing statement and settled at the close of escrow. If the transaction falls through during the feasibility or title period, no transaction fee is charged by TRACT.',
    category: 'Transaction Fees & Payments',
    order: 2,
    isPublished: true,
  },
  // ── Bidding & Closing Process ───────
  {
    question: 'How do I submit an offer on a property?',
    answer:
      'Once your account is verified, navigate to the property profile, input your desired purchase price, escrow deposit amount, and target closing date, then click "Submit Offer." This generates a formal digital intent framework sent directly to the asset provider.',
    category: 'Bidding & Closing Process',
    order: 1,
    isPublished: true,
  },
  {
    question: 'What happens after my offer is accepted?',
    answer:
      'Once accepted, TRACT automatically locks the deal and generates the necessary digital routing paths for title and escrow. Both parties will be introduced to the assigned closing coordinator to oversee earnest money deposit (EMD) submission and title clearance.',
    category: 'Bidding & Closing Process',
    order: 2,
    isPublished: true,
  },
  {
    question: 'Who handles title and escrow?',
    answer:
      'Transactions can be routed through TRACT\'s preferred investor-friendly title companies or if buyers have their own title companies and closing attorneys to ensure speed, or parties can mutually agree on a designated local closing office during the offer phase.',
    category: 'Bidding & Closing Process',
    order: 3,
    isPublished: true,
  },
  // ── Shared Platform Mechanics ───────
  {
    question: 'How does TRACT protect equitable interest and prevent chain-linking?',
    answer:
      'TRACT actively vets listings to ensure the provider holds direct equitable interest (a valid, executable purchase and sale agreement) or direct ownership. Unauthorized re-marketing or "daisy-chaining" of deals without contract control is strictly prohibited.',
    category: 'Shared Platform Mechanics & Security',
    order: 1,
    isPublished: true,
  },
  {
    question: 'What happens if a party defaults on a transaction?',
    answer:
      'Standard legal real estate remedies apply as dictated by the executed assignment or purchase agreement. Earnest money deposits are held securely in a third-party escrow account and disbursed according to contract terms if a default occurs.',
    category: 'Shared Platform Mechanics & Security',
    order: 2,
    isPublished: true,
  },
]

async function main() {
  // Validate categories before connecting
  for (const entry of FAQ_ENTRIES) {
    if (!VALID_CATEGORIES.has(
      entry.category as typeof FAQ_CATEGORIES[number]
    )) {
      console.error(
        `Invalid category "${entry.category}" ` +
        `on question: "${entry.question}"`
      )
      process.exit(1)
    }
  }

  await mongoose.connect(MONGODB_URI!)
  console.log('✅ Connected to MongoDB')

  const db = mongoose.connection.db
  if (!db) {
    console.error('MongoDB connection has no database handle')
    process.exit(1)
  }

  const col = db.collection('faqs')

  let inserted = 0
  let updated = 0

  for (const entry of FAQ_ENTRIES) {
    const baseSlug = toSlug(entry.question)
    const slug = await uniqueSlug(baseSlug, col)

    // Try to find existing doc by slug first,
    // fall back to question match for docs
    // seeded before slug field existed
    const existing = await col.findOne({
      $or: [
        { slug },
        { question: entry.question },
      ],
    })

    if (existing) {
      const finalSlug = await uniqueSlug(
        baseSlug,
        col,
        existing._id.toString(),
      )
      await col.updateOne(
        { _id: existing._id },
        { $set: { ...entry, slug: finalSlug } },
      )
      updated++
      console.log(`↺  Updated: ${entry.question}`)
    } else {
      await col.insertOne({ ...entry, slug })
      inserted++
      console.log(`✅ Inserted: ${entry.question}`)
    }
  }

  console.log(
    `\nDone: ${inserted} inserted, ${updated} updated`,
  )
  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
