import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { BuyerController } from './buyer.controller'
import { BuyerService } from './buyer.service'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Bid, BidSchema } from '../bids/schemas/bid.schema'
import { User, UserSchema } from '../users/schemas/user.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Bid.name, schema: BidSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [BuyerController],
  providers: [BuyerService],
  exports: [BuyerService],
})
export class BuyerModule {}
