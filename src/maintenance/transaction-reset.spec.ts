import {
  FULL_RESET_COLLECTIONS,
  MIXED_RESET_PLANS,
  cloudinaryAssetFromUrl,
  createTransactionResetPlan,
  dbNameFromMongoUri,
  executeTransactionReset,
} from './transaction-reset'

function collection(count: number, docs: Array<Record<string, unknown>> = []) {
  return {
    countDocuments: jest.fn(async () => count),
    find: jest.fn(() => ({ toArray: async () => docs })),
    deleteMany: jest.fn(async () => ({ deletedCount: count })),
  }
}

function db(collections: Record<string, ReturnType<typeof collection>>) {
  return {
    databaseName: 'tract',
    collection: jest.fn((name: string) => {
      if (!collections[name]) collections[name] = collection(0)
      return collections[name]
    }),
  }
}

describe('transaction reset plan', () => {
  it('targets transaction collections and preserves account, subscription, payment and support data', async () => {
    const database = db({
      listings: collection(2, [{ photoUrls: ['https://res.cloudinary.com/tract/image/upload/v1/listings/a.jpg'] }]),
      bids: collection(3),
      contracts: collection(1, [{ pdfUrl: 'https://res.cloudinary.com/tract/raw/upload/v1/contracts/c.pdf' }]),
      deals: collection(1),
      messages: collection(4),
      ratings: collection(1),
      vaultdocuments: collection(1, [{ fileUrl: 'https://res.cloudinary.com/tract/raw/upload/v1/vault/v.pdf' }]),
      app2_usage_counters: collection(2),
      notifications: collection(5),
      penalties: collection(2),
      users: collection(10),
      app2_subscriptions: collection(7),
      payments: collection(6),
      support_tickets: collection(2),
      verifications: collection(9),
    })

    const plan = await createTransactionResetPlan(database as never, { cloudinaryCloudName: 'tract' })

    expect(plan.fullCollections.map((item) => item.collection)).toEqual(FULL_RESET_COLLECTIONS)
    expect(plan.mixedCollections.map((item) => item.collection)).toEqual(MIXED_RESET_PLANS.map((item) => item.collection))
    expect(plan.preservedCollections.map((item) => item.collection)).toEqual([
      'users',
      'app2_subscriptions',
      'payments',
      'support_tickets',
      'verifications',
      'title_companies',
      'sessions',
    ])
    expect(plan.uploads).toEqual(expect.arrayContaining([
      { publicId: 'listings/a', resourceType: 'image', url: 'https://res.cloudinary.com/tract/image/upload/v1/listings/a.jpg' },
      { publicId: 'contracts/c.pdf', resourceType: 'raw', url: 'https://res.cloudinary.com/tract/raw/upload/v1/contracts/c.pdf' },
      { publicId: 'vault/v.pdf', resourceType: 'raw', url: 'https://res.cloudinary.com/tract/raw/upload/v1/vault/v.pdf' },
    ]))
  })

  it('does not delete anything in dry run mode', async () => {
    const listings = collection(2)
    const notifications = collection(1)
    const database = db({ listings, notifications })
    const plan = await createTransactionResetPlan(database as never, {})

    const result = await executeTransactionReset(database as never, plan, { execute: false })

    expect(result.executed).toBe(false)
    expect(listings.deleteMany).not.toHaveBeenCalled()
    expect(notifications.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes only allowlisted full collections and mixed collection filters when executed', async () => {
    const listings = collection(2)
    const notifications = collection(4)
    const penalties = collection(3)
    const users = collection(10)
    const database = db({ listings, notifications, penalties, users })
    const plan = await createTransactionResetPlan(database as never, {})

    const result = await executeTransactionReset(database as never, plan, { execute: true })

    expect(result.executed).toBe(true)
    expect(listings.deleteMany).toHaveBeenCalledWith({})
    expect(notifications.deleteMany).toHaveBeenCalledWith(MIXED_RESET_PLANS.find((item) => item.collection === 'notifications')?.filter)
    expect(penalties.deleteMany).toHaveBeenCalledWith(MIXED_RESET_PLANS.find((item) => item.collection === 'penalties')?.filter)
    expect(users.deleteMany).not.toHaveBeenCalled()
  })
})

describe('cloudinary asset parsing', () => {
  it('extracts image and raw public IDs only from the configured Cloudinary account', () => {
    expect(cloudinaryAssetFromUrl('https://res.cloudinary.com/tract/image/upload/v1/listings/front.jpg', 'tract')).toEqual({
      publicId: 'listings/front',
      resourceType: 'image',
      url: 'https://res.cloudinary.com/tract/image/upload/v1/listings/front.jpg',
    })
    expect(cloudinaryAssetFromUrl('https://res.cloudinary.com/tract/raw/upload/v1/contracts/final.pdf', 'tract')).toEqual({
      publicId: 'contracts/final.pdf',
      resourceType: 'raw',
      url: 'https://res.cloudinary.com/tract/raw/upload/v1/contracts/final.pdf',
    })
    expect(cloudinaryAssetFromUrl('https://res.cloudinary.com/other/image/upload/v1/listings/front.jpg', 'tract')).toBeNull()
    expect(cloudinaryAssetFromUrl('https://example.com/listings/front.jpg', 'tract')).toBeNull()
  })
})

describe('MongoDB reset database guard', () => {
  it('extracts the database name from replica-set and srv connection strings', () => {
    expect(dbNameFromMongoUri('mongodb://u:p@host-a:27017,host-b:27017/tract?replicaSet=rs0')).toBe('tract')
    expect(dbNameFromMongoUri('mongodb+srv://u:p@example.mongodb.net/tract?retryWrites=true')).toBe('tract')
  })
})
