import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ListingsController } from './listings.controller'
import { ListingsService } from './listings.service'
import { Listing, ListingSchema } from './schemas/listing.schema'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
  ],
  controllers: [ListingsController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
