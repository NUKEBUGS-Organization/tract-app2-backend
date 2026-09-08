export type ResourceType = 'image' | 'raw'

export type CloudinaryAsset = {
  publicId: string
  resourceType: ResourceType
  url: string
}

type CollectionLike = {
  countDocuments(filter?: Record<string, unknown>): Promise<number>
  find(filter?: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<Array<Record<string, unknown>>> }
  deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount?: number }>
}

type DbLike = {
  databaseName: string
  collection(name: string): CollectionLike
}

export type ResetCollectionPlan = {
  collection: string
  filter: Record<string, unknown>
  count: number
}

export type TransactionResetPlan = {
  databaseName: string
  fullCollections: ResetCollectionPlan[]
  mixedCollections: ResetCollectionPlan[]
  preservedCollections: Array<{ collection: string; count: number }>
  uploads: CloudinaryAsset[]
}

export const FULL_RESET_COLLECTIONS = [
  'listings',
  'bids',
  'contracts',
  'deals',
  'messages',
  'ratings',
  'vaultdocuments',
  'app2_usage_counters',
]

export const MIXED_RESET_PLANS: Array<{ collection: string; filter: Record<string, unknown> }> = [
  {
    collection: 'notifications',
    filter: {
      $or: [
        { listingId: { $ne: null } },
        { dealId: { $ne: null } },
        {
          type: {
            $in: [
              'bid_received',
              'timer_warning',
              'kill_switch',
              'chat_unlocked',
              'score_penalty',
              'contract_ready',
              'contract_executed',
              'deal_advanced',
              'deal_cancelled',
              'deal_closed',
            ],
          },
        },
      ],
    },
  },
  {
    collection: 'penalties',
    filter: { $or: [{ listingId: { $ne: null } }, { dealId: { $ne: null } }] },
  },
]

export const PRESERVED_COLLECTIONS = [
  'users',
  'app2_subscriptions',
  'payments',
  'support_tickets',
  'verifications',
  'title_companies',
  'sessions',
]

export function dbNameFromMongoUri(uri: string) {
  const withoutScheme = uri.replace(/^mongodb(?:\+srv)?:\/\//, '')
  if (withoutScheme === uri) throw new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://.')
  const pathStart = withoutScheme.indexOf('/')
  if (pathStart < 0) throw new Error('MONGODB_URI must include the application database name.')
  const path = withoutScheme.slice(pathStart + 1)
  const dbName = decodeURIComponent(path.split('?')[0] ?? '').trim()
  if (!dbName) throw new Error('MONGODB_URI must include the application database name.')
  if (['admin', 'config', 'local'].includes(dbName)) {
    throw new Error(`Refusing to reset reserved MongoDB database "${dbName}".`)
  }
  return dbName
}

const UPLOAD_COLLECTION_FIELDS: Record<string, string[]> = {
  listings: ['photoUrls'],
  contracts: ['originalPdfUrl', 'pdfUrl', 'signedPdfUrl'],
  deals: ['photoUrls'],
  vaultdocuments: ['fileUrl'],
}

export function cloudinaryAssetFromUrl(rawUrl: unknown, cloudName?: string): CloudinaryAsset | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return null
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length < 4) return null
  const [actualCloudName, resourceType, deliveryType] = parts
  if (cloudName && actualCloudName !== cloudName) return null
  if ((resourceType !== 'image' && resourceType !== 'raw') || deliveryType !== 'upload') return null

  const uploadTail = parts.slice(3)
  const versionIndex = uploadTail.findIndex((part) => /^v\d+$/.test(part))
  const publicParts = versionIndex >= 0 ? uploadTail.slice(versionIndex + 1) : uploadTail
  if (!publicParts.length) return null

  if (resourceType === 'image') {
    const last = publicParts[publicParts.length - 1]
    publicParts[publicParts.length - 1] = last.replace(/\.[^.]+$/, '')
  }

  const publicId = publicParts.join('/')
  return publicId ? { publicId, resourceType, url: rawUrl } : null
}

function collectUrls(value: unknown, urls: string[]) {
  if (typeof value === 'string') {
    urls.push(value)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, urls))
  }
}

async function collectManagedUploads(db: DbLike, cloudinaryCloudName?: string) {
  const assets: CloudinaryAsset[] = []
  for (const [collectionName, fields] of Object.entries(UPLOAD_COLLECTION_FIELDS)) {
    const projection = Object.fromEntries(fields.map((field) => [field, 1]))
    const docs = await db.collection(collectionName).find({}, { projection }).toArray()
    for (const doc of docs) {
      const urls: string[] = []
      fields.forEach((field) => collectUrls(doc[field], urls))
      for (const url of urls) {
        const asset = cloudinaryAssetFromUrl(url, cloudinaryCloudName)
        if (asset) assets.push(asset)
      }
    }
  }
  const unique = new Map<string, CloudinaryAsset>()
  assets.forEach((asset) => unique.set(`${asset.resourceType}:${asset.publicId}`, asset))
  return [...unique.values()]
}

export async function createTransactionResetPlan(
  db: DbLike,
  options: { cloudinaryCloudName?: string },
): Promise<TransactionResetPlan> {
  const fullCollections = await Promise.all(FULL_RESET_COLLECTIONS.map(async (collection) => ({
    collection,
    filter: {},
    count: await db.collection(collection).countDocuments({}),
  })))
  const mixedCollections = await Promise.all(MIXED_RESET_PLANS.map(async ({ collection, filter }) => ({
    collection,
    filter,
    count: await db.collection(collection).countDocuments(filter),
  })))
  const preservedCollections = await Promise.all(PRESERVED_COLLECTIONS.map(async (collection) => ({
    collection,
    count: await db.collection(collection).countDocuments({}),
  })))

  return {
    databaseName: db.databaseName,
    fullCollections,
    mixedCollections,
    preservedCollections,
    uploads: await collectManagedUploads(db, options.cloudinaryCloudName),
  }
}

export async function executeTransactionReset(
  db: DbLike,
  plan: TransactionResetPlan,
  options: { execute: boolean },
) {
  if (!options.execute) {
    return { executed: false, deleted: [] as Array<{ collection: string; deletedCount: number }> }
  }

  const deleted: Array<{ collection: string; deletedCount: number }> = []
  for (const item of [...plan.fullCollections, ...plan.mixedCollections]) {
    const result = await db.collection(item.collection).deleteMany(item.filter)
    deleted.push({ collection: item.collection, deletedCount: result.deletedCount ?? 0 })
  }
  return { executed: true, deleted }
}
