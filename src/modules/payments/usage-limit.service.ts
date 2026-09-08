import { ForbiddenException, Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { SubscriptionsService } from './subscriptions.service'
import { UsageCounter, UsageCounterDocument, UsageKind } from './schemas/usage-counter.schema'

const FREE_LIMIT = 10

export interface UsageAllowance {
  used: number
  freeLimit: number
  remaining: number
  subscriptionRequired: boolean
}

@Injectable()
export class UsageLimitService {
  constructor(
    @InjectModel(UsageCounter.name) private readonly counters: Model<UsageCounterDocument>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private async used(userId: string, kind: UsageKind): Promise<number> {
    const row = await this.counters.findOne({ userId: new Types.ObjectId(userId), kind }).lean().exec()
    return row?.used ?? 0
  }

  private allowance(used: number, subscriptionRequired: boolean): UsageAllowance {
    return {
      used,
      freeLimit: FREE_LIMIT,
      remaining: Math.max(0, FREE_LIMIT - used),
      subscriptionRequired,
    }
  }

  private async isActive(userId: string): Promise<boolean> {
    return (await this.subscriptions.getStatus(userId)).active
  }

  async getAllowance(userId: string, kind: UsageKind): Promise<UsageAllowance> {
    const used = await this.used(userId, kind)
    return this.allowance(used, used >= FREE_LIMIT && !(await this.isActive(userId)))
  }

  async consumeAttempt(userId: string, kind: UsageKind): Promise<UsageAllowance> {
    const objectId = new Types.ObjectId(userId)
    try {
      const counter = await this.counters.findOneAndUpdate(
        { userId: objectId, kind, used: { $lt: FREE_LIMIT } },
        { $setOnInsert: { userId: objectId, kind }, $inc: { used: 1 } },
        { upsert: true, returnDocument: 'after' },
      ).exec()
      return this.allowance(counter.used, false)
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err
    }

    const current = await this.used(userId, kind)
    // A concurrent first attempt can race the unique-index upsert before the
    // counter document exists. Re-run the conditional increment against the
    // winning document rather than treating that transient duplicate as paid-only.
    if (current < FREE_LIMIT) return this.consumeAttempt(userId, kind)
    if (!(await this.isActive(userId))) {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'Your 10 free lifetime attempts are used. Subscribe to continue.',
      })
    }

    const counter = await this.counters.findOneAndUpdate(
      { userId: objectId, kind },
      { $inc: { used: 1 } },
      { returnDocument: 'after' },
    ).exec()
    return this.allowance(counter?.used ?? current + 1, false)
  }

  async compensateAttempt(userId: string, kind: UsageKind): Promise<void> {
    await this.counters.updateOne(
      { userId: new Types.ObjectId(userId), kind, used: { $gt: 0 } },
      { $inc: { used: -1 } },
    ).exec()
  }
}
