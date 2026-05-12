import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { BidsController } from './bids.controller'
import { BidsService } from './bids.service'
import { Bid, BidSchema } from './schemas/bid.schema'
import { ListingsModule } from '../listings/listings.module'
import { GatewayModule } from '../gateway/gateway.module'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Bid.name, schema: BidSchema },
      { name: Listing.name, schema: ListingSchema },
    ]),
    ListingsModule,
    GatewayModule,
  ],
  controllers: [BidsController],
  providers: [BidsService],
  exports: [BidsService],
})
export class BidsModule {}
