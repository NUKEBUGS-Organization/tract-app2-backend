import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectModel, InjectConnection } from '@nestjs/mongoose'
import { Connection, Model, Types } from 'mongoose'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { DealType } from '../../common/enums/deal-type.enum'
import { isMongoDuplicateKeyError } from '../../common/utils/mongo-errors'

/**
 * App1 (Seller Tract) has no code that calls App2. The two services only share
 * one Mongo database. This poller closes the integration gap from the App2 side
 * only: it reads App1-shaped signed deals straight from the shared collections
 * and projects each into a native App2 marketplace listing, linked by
 * `app1DealId`. Idempotent — safe to run on a timer and on demand.
 *
 * Trade-off: this deepens the cross-schema DB coupling that is already the
 * platform's #1 architectural risk. The clean fix is a push API in App1; this
 * is the App2-only stopgap.
 */

// App1 deal.status values that mean "signed, ready to be marketed on App2".
const APP1_MARKETABLE = ['active', 'proceeding_to_closing']
// App1 deal.status values that should retire the mirrored listing.
const APP1_CLOSED = ['closed']
const APP1_DEAD = ['cancelled', 'under_review', 'backup_activated']

// App1 user roles allowed to re-market a deal on the App2 marketplace.
const MARKETER_ROLES = new Set(['wholesaler', 'realtor'])

// Local listing states we must never overwrite from an App1 status change.
const LOCAL_TERMINAL = new Set<string>([
  ListingStatus.UNDER_CONTRACT,
  ListingStatus.CLOSED,
])

export interface App1SyncResult {
  scanned: number
  created: number
  updated: number
  retired: number
  skipped: number
  errors: number
}

@Injectable()
export class App1SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(App1SyncService.name)
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('app1Sync.enabled') === false) {
      this.logger.log(
        'App1 -> App2 listing sync poller disabled (set APP1_SYNC_ENABLED=true to enable)',
      )
      return
    }
    const intervalMs = this.config.get<number>('app1Sync.intervalMs') ?? 120_000
    this.timer = setInterval(() => {
      this.syncMarketableDeals().catch((err) => {
        this.logger.error(`App1 sync tick failed: ${err instanceof Error ? err.message : err}`)
      })
    }, intervalMs)
    // Don't hold the event loop open for this in tests / shutdown.
    this.timer.unref?.()
    this.logger.log(`App1 -> App2 listing sync poller started (every ${Math.round(intervalMs / 1000)}s)`)
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /**
   * One pass: project every marketable App1 deal into an App2 listing, and
   * retire mirrors whose source deal died. Guarded against overlapping runs.
   */
  async syncMarketableDeals(): Promise<App1SyncResult> {
    const res: App1SyncResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      retired: 0,
      skipped: 0,
      errors: 0,
    }
    if (this.running) {
      this.logger.warn('App1 sync already in progress — skipping this run')
      return res
    }
    this.running = true
    try {
      const db = this.connection.db
      if (!db) throw new Error('Mongo connection not ready')

      const deals = db.collection('deals')
      const listingsApp1 = db.collection('listings')
      const contracts = db.collection('contracts')
      const bids = db.collection('bids')
      const users = db.collection('users')

      // App1 deals carry `contract_id`; App2 deals never do — that is how we
      // tell the two shapes apart inside the shared collection.
      const cursor = deals.find({
        contract_id: { $exists: true, $ne: null },
        deleted_at: null,
        status: { $in: [...APP1_MARKETABLE, ...APP1_CLOSED, ...APP1_DEAD] },
      })

      for await (const deal of cursor) {
        res.scanned++
        const app1DealId = String(deal._id)
        try {
          const existing = await this.listingModel
            .findOne({ app1DealId })
            .exec()

          // Coexistence rule: if a listing for this deal already exists and was
          // NOT made by this poller, a wholesaler created it via Create Listing
          // (Property Source). That path owns the row end to end — never touch it.
          if (existing && !existing.app1SyncManaged) {
            res.skipped++
            continue
          }

          const status = String(deal.status ?? '').toLowerCase()

          // ---- retire path: source deal died / closed ----
          if (APP1_CLOSED.includes(status) || APP1_DEAD.includes(status)) {
            if (!existing) {
              res.skipped++
              continue
            }
            const next = APP1_CLOSED.includes(status)
              ? ListingStatus.CLOSED
              : ListingStatus.CANCELLED
            // Only retire a still-open mirror; never walk back a local progression.
            const retirable =
              next === ListingStatus.CLOSED
                ? [ListingStatus.LIVE, ListingStatus.UNDER_CONTRACT]
                : [ListingStatus.LIVE, ListingStatus.PENDING_REVIEW, ListingStatus.DRAFT]
            if (!retirable.includes(existing.status)) {
              res.skipped++
              continue
            }
            existing.status = next
            existing.bidsOpen = false
            await existing.save()
            res.retired++
            continue
          }

          // ---- marketable path ----
          const app1Listing = deal.listing_id
            ? await listingsApp1.findOne({ _id: new Types.ObjectId(String(deal.listing_id)) })
            : null
          if (!app1Listing) {
            this.logger.warn(`App1 deal ${app1DealId}: source listing missing — skipped`)
            res.skipped++
            continue
          }

          const contract = deal.contract_id
            ? await contracts.findOne({ _id: new Types.ObjectId(String(deal.contract_id)) })
            : null
          const bid = contract?.bid_id
            ? await bids.findOne({ _id: new Types.ObjectId(String(contract.bid_id)) })
            : null

          // The marketer = the App1 deal's buyer (the wholesaler/realtor who
          // won it). Shared `users` collection => the same _id is valid in App2.
          const marketer = deal.buyer_id
            ? await users.findOne({ _id: new Types.ObjectId(String(deal.buyer_id)) })
            : null
          const role = String(marketer?.role ?? '').toLowerCase()
          if (!marketer || !MARKETER_ROLES.has(role)) {
            // End-buyer deal with nothing to re-market on App2.
            res.skipped++
            continue
          }

          if (existing) {
            // Own mirror, still open: refresh projected fields, keep it live.
            if (LOCAL_TERMINAL.has(existing.status)) {
              res.skipped++
              continue
            }
            existing.set(this.projectFields(deal, app1Listing, contract, bid, marketer))
            if (existing.status !== ListingStatus.LIVE) existing.status = ListingStatus.LIVE
            existing.bidsOpen = true
            await existing.save()
            res.updated++
            continue
          }

          try {
            await this.listingModel.create({
              ...this.projectFields(deal, app1Listing, contract, bid, marketer),
              status: ListingStatus.LIVE,
              bidsOpen: true,
              bidCount: 0,
              publishedAt: new Date(),
              // An App1-sourced listing already carries executed marketing intent.
              marketingProofSatisfiedByListing: true,
              app1SyncManaged: true,
              app1DealId,
              app1ContractId: contract?._id ?? null,
              app1PropertyId: app1Listing._id ?? null,
            })
            res.created++
          } catch (createErr) {
            // Lost the race (another poller run / a wholesaler Create Listing
            // for the same deal) — the partial unique index rejected the dup.
            if (isMongoDuplicateKeyError(createErr)) {
              res.skipped++
            } else {
              throw createErr
            }
          }
        } catch (err) {
          res.errors++
          this.logger.error(
            `App1 deal ${app1DealId} sync failed: ${err instanceof Error ? err.message : err}`,
          )
        }
      }

      if (res.created || res.updated || res.retired || res.errors) {
        this.logger.log(
          `App1 sync: scanned ${res.scanned}, +${res.created} created, ` +
            `~${res.updated} updated, -${res.retired} retired, ${res.errors} errors`,
        )
      }
      return res
    } finally {
      this.running = false
    }
  }

  /** Map App1 snake_case deal/listing/bid docs -> App2 listing fields. */
  private projectFields(
    _deal: Record<string, unknown>,
    app1Listing: Record<string, unknown>,
    _contract: Record<string, unknown> | null,
    bid: Record<string, unknown> | null,
    marketer: Record<string, unknown>,
  ): Record<string, unknown> {
    const num = (v: unknown): number => {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
    const marketPrice = num(app1Listing.market_price)
    const suggested = num(app1Listing.suggested_price)
    const bidPrice = num(bid?.bid_price)

    return {
      wholesalerId: new Types.ObjectId(String(marketer._id)),
      propertyAddress: String(app1Listing.address ?? ''),
      city: String(app1Listing.city ?? ''),
      stateCode: String(app1Listing.state_code ?? '').toUpperCase(),
      zipCode: String(app1Listing.zip_code ?? ''),
      // App1 PropertyType doesn't map 1:1 to App2 DealType; default sensibly.
      dealType: DealType.FIX_FLIP,
      marketStatus: 'off_market',
      arv: suggested || marketPrice,
      purchasePrice: bidPrice || marketPrice,
      rehabBreakdown: {},
      rehabTotal: 0,
      // hidden_reserve is AES-256 encrypted in App1 and unreadable here, so no
      // lowball reserve is carried over.
      assignmentFeeLow: 0,
      assignmentFeeHigh: 0,
      photoUrls: Array.isArray(app1Listing.picture_urls)
        ? (app1Listing.picture_urls as string[]).filter((u) => typeof u === 'string')
        : [],
    }
  }
}
