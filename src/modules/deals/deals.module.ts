import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { DealsController } from './deals.controller'
import { DealsService } from './deals.service'
import { Deal, DealSchema } from './schemas/deal.schema'
import { Bid, BidSchema } from '../bids/schemas/bid.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Contract, ContractSchema } from '../contracts/schemas/contract.schema'
import { JobsModule } from '../jobs/jobs.module'
import { GatewayModule } from '../gateway/gateway.module'
import { NotificationsModule } from '../notifications/notifications.module'
import { App1BidsModule } from '../app1-bids/app1-bids.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Bid.name, schema: BidSchema },
      { name: Listing.name, schema: ListingSchema },
      { name: User.name, schema: UserSchema },
      { name: Contract.name, schema: ContractSchema },
    ]),
    JobsModule,
    GatewayModule,
    NotificationsModule,
    App1BidsModule,
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
