import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Job } from 'bullmq'
import { User, UserDocument } from '../users/schemas/user.schema'
import { QUEUES, ACTIVITY_JOBS } from './queue.constants'

const INACTIVITY_RESTRICTION_DAYS = 14

@Processor(QUEUES.ACTIVITY)
export class ActivityProcessor extends WorkerHost {
  private readonly logger = new Logger(ActivityProcessor.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case ACTIVITY_JOBS.CHECK_30DAY_INACTIVITY:
        await this.handle30dayInactivity(job.data.userId)
        break
      default:
        this.logger.warn(`Unknown job: ${job.name}`)
    }
  }

  private async handle30dayInactivity(userId: string): Promise<void> {
    this.logger.log(`Running 30-day inactivity check for user ${userId}`)

    const user = await this.userModel.findById(userId)
    if (!user) return

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    if (user.lastActiveAt && user.lastActiveAt > thirtyDaysAgo) {
      this.logger.log(`User ${userId} was active recently. No restriction.`)
      return
    }

    const restrictedUntil = new Date(Date.now() + INACTIVITY_RESTRICTION_DAYS * 24 * 60 * 60 * 1000)

    await this.userModel.findByIdAndUpdate(userId, {
      scoreRestrictedUntil: restrictedUntil,
    })

    this.logger.warn(
      `User ${userId} restricted for 14 days due to 30-day inactivity. ` +
        `Restriction until: ${restrictedUntil.toISOString()}`,
    )
  }
}
