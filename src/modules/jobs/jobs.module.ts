import { Module } from '@nestjs/common'
import { BullModule } from '@nestjs/bullmq'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'

import { KillSwitchProcessor } from './kill-switch.processor'
import { ActivityProcessor } from './activity.processor'
import { JobsService } from './jobs.service'

import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { Bid, BidSchema } from '../bids/schemas/bid.schema'
import { PenaltiesModule } from '../penalties/penalties.module'
import { QUEUES } from './queue.constants'

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>('redis.url') ?? 'redis://localhost:6379',
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: QUEUES.KILL_SWITCH }, { name: QUEUES.ACTIVITY }),
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: User.name, schema: UserSchema },
      { name: Listing.name, schema: ListingSchema },
      { name: Bid.name, schema: BidSchema },
    ]),
    PenaltiesModule,
  ],
  providers: [KillSwitchProcessor, ActivityProcessor, JobsService],
  exports: [JobsService],
})
export class JobsModule {}
