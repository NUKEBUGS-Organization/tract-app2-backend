import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ListingsController } from './listings.controller'
import { InternalListingsController } from './internal-listings.controller'
import { ListingsService } from './listings.service'
import { Listing, ListingSchema } from './schemas/listing.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { App1BidsModule } from '../app1-bids/app1-bids.module'
import { CloudinaryService } from '../../common/services/cloudinary.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
    App1BidsModule,
  ],
  controllers: [ListingsController, InternalListingsController],
  providers: [ListingsService, CloudinaryService],
  exports: [ListingsService],
})
export class ListingsModule {}
