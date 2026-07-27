import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ListingsController } from './listings.controller'
import { InternalListingsController } from './internal-listings.controller'
import { ListingsService } from './listings.service'
import { Listing, ListingSchema } from './schemas/listing.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  controllers: [ListingsController, InternalListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
