import { Injectable, Logger } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { QUEUES, KILL_SWITCH_JOBS, ACTIVITY_JOBS } from './queue.constants'

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name)

  constructor(
    @InjectQueue(QUEUES.KILL_SWITCH)
    private readonly killSwitchQueue: Queue,
    @InjectQueue(QUEUES.ACTIVITY)
    private readonly activityQueue: Queue,
  ) {}

  async schedule72hrCheck(dealId: string, deadlineAt: Date): Promise<void> {
    const delay = deadlineAt.getTime() - Date.now()
    if (delay <= 0) {
      this.logger.warn(`72hr deadline already passed for deal ${dealId}`)
      return
    }

    await this.killSwitchQueue.add(
      KILL_SWITCH_JOBS.CHECK_72HR_DEADLINE,
      { dealId },
      {
        delay,
        jobId: `72hr-${dealId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    )

    this.logger.log(
      `72hr kill switch scheduled for deal ${dealId} ` +
        `at ${deadlineAt.toISOString()} ` +
        `(in ${Math.round(delay / 3600000)}h)`,
    )
  }

  async schedule7dayRealtorCheck(dealId: string, deadlineAt: Date): Promise<void> {
    const delay = deadlineAt.getTime() - Date.now()
    if (delay <= 0) return

    await this.killSwitchQueue.add(
      KILL_SWITCH_JOBS.CHECK_7DAY_REALTOR,
      { dealId },
      {
        delay,
        jobId: `7day-${dealId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    )

    this.logger.log(`7-day Realtor check scheduled for deal ${dealId}`)
  }

  async scheduleBackupActivation(dealId: string, deadlineAt: Date): Promise<void> {
    const delay = deadlineAt.getTime() - Date.now()
    if (delay <= 0) return

    await this.killSwitchQueue.add(
      KILL_SWITCH_JOBS.CHECK_BACKUP_ACTIVATION,
      { dealId },
      {
        delay,
        jobId: `backup-${dealId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    )

    this.logger.log(`Backup activation check scheduled for deal ${dealId}`)
  }

  async schedule30dayCheck(userId: string): Promise<void> {
    const thirtyDays = 30 * 24 * 60 * 60 * 1000

    await this.activityQueue.add(
      ACTIVITY_JOBS.CHECK_30DAY_INACTIVITY,
      { userId },
      {
        delay: thirtyDays,
        jobId: `30day-${userId}`,
        attempts: 2,
        removeOnComplete: true,
        removeOnFail: false,
      },
    )

    this.logger.log(`30-day inactivity check scheduled for user ${userId}`)
  }

  async cancelJob(queue: 'kill-switch' | 'activity', jobId: string): Promise<void> {
    const q = queue === 'kill-switch' ? this.killSwitchQueue : this.activityQueue

    const job = await q.getJob(jobId)
    if (job) {
      await job.remove()
      this.logger.log(`Job ${jobId} cancelled.`)
    }
  }

  async cancel72hrCheck(dealId: string): Promise<void> {
    await this.cancelJob('kill-switch', `72hr-${dealId}`)
  }
}
