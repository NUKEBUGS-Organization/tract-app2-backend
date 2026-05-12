import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Job } from 'bullmq'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { Listing, ListingDocument } from '../listings/schemas/listing.schema'
import { Bid, BidDocument } from '../bids/schemas/bid.schema'
import { ScoringService } from '../penalties/scoring.service'
import { ViolationType } from '../penalties/schemas/penalty.schema'
import { BidStatus } from '../../common/enums/bid-status.enum'
import { ListingStatus } from '../../common/enums/listing-status.enum'
import { QUEUES, KILL_SWITCH_JOBS } from './queue.constants'

@Processor(QUEUES.KILL_SWITCH)
export class KillSwitchProcessor extends WorkerHost {
  private readonly logger = new Logger(KillSwitchProcessor.name)

  constructor(
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    @InjectModel(Listing.name)
    private readonly listingModel: Model<ListingDocument>,
    @InjectModel(Bid.name)
    private readonly bidModel: Model<BidDocument>,
    private readonly scoringService: ScoringService,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case KILL_SWITCH_JOBS.CHECK_72HR_DEADLINE:
        await this.handle72hrDeadline(job.data.dealId)
        break
      case KILL_SWITCH_JOBS.CHECK_7DAY_REALTOR:
        await this.handle7dayRealtor(job.data.dealId)
        break
      case KILL_SWITCH_JOBS.CHECK_BACKUP_ACTIVATION:
        await this.handleBackupActivation(job.data.dealId)
        break
      default:
        this.logger.warn(`Unknown job: ${job.name}`)
    }
  }

  private async handle72hrDeadline(dealId: string): Promise<void> {
    this.logger.log(`Running 72hr check for deal ${dealId}`)

    const deal = await this.dealModel.findById(dealId)
    if (!deal) return

    if (deal.marketingProofUploaded) {
      this.logger.log(`Deal ${dealId} — proof uploaded in time. No action.`)
      return
    }

    this.logger.warn(`Kill switch fired for deal ${dealId} — 72hr deadline missed by ${deal.wholesalerId}`)

    await this.scoringService.applyViolation(deal.wholesalerId.toString(), ViolationType.MISSED_72HR_DEADLINE, {
      dealId,
    })

    await this.dealModel.findByIdAndUpdate(dealId, {
      killSwitchFired: true,
    })

    this.logger.log(
      `72hr kill switch applied on deal ${dealId}. Wholesaler ${deal.wholesalerId} penalised -15 score.`,
    )
  }

  private async handle7dayRealtor(dealId: string): Promise<void> {
    this.logger.log(`Running 7-day Realtor check for ${dealId}`)

    const deal = await this.dealModel.findById(dealId)
    if (!deal) return

    if (deal.marketingProofUploaded) {
      this.logger.log(`Deal ${dealId} — Realtor proof uploaded in time.`)
      return
    }

    await this.scoringService.applyViolation(deal.wholesalerId.toString(), ViolationType.MISSED_72HR_DEADLINE, {
      dealId,
    })

    this.logger.warn(`7-day Realtor deadline missed on deal ${dealId}`)
  }

  private async handleBackupActivation(dealId: string): Promise<void> {
    this.logger.log(`Running backup activation check for deal ${dealId}`)

    const deal = await this.dealModel.findById(dealId)
    if (!deal) return

    if (!deal.buyerFailed) return

    if (deal.backup2BidId) {
      const bid = await this.bidModel.findById(deal.backup2BidId)
      if (bid?.status === BidStatus.PRIMARY) {
        this.logger.log(`Deal ${dealId} — Backup #2 accepted. No action.`)
        return
      }
    }

    if (deal.backup3BidId && deal.backup3BuyerId) {
      await Promise.all([
        this.bidModel.findByIdAndUpdate(deal.backup3BidId, {
          status: BidStatus.PRIMARY,
        }),
        this.dealModel.findByIdAndUpdate(dealId, {
          primaryBuyerId: deal.backup3BuyerId,
          primaryBidId: deal.backup3BidId,
          backup2BidId: null,
          backup2BuyerId: null,
          backup3BidId: null,
          backup3BuyerId: null,
          backupActivationDeadline: null,
        }),
      ])

      this.logger.log(`Deal ${dealId} — Backup #3 promoted to primary.`)
    } else {
      await Promise.all([
        this.dealModel.findByIdAndUpdate(dealId, {
          buyerFailed: true,
          buyerFailedReason: 'walked_away',
        }),
        this.listingModel.findByIdAndUpdate(deal.listingId, {
          status: ListingStatus.CANCELLED,
          bidsOpen: false,
        }),
      ])

      this.logger.warn(`Deal ${dealId} — No backups available. Deal cancelled.`)
    }
  }
}
