import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { TitleController } from './title.controller'
import { TitleService } from './title.service'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Listing.name, schema: ListingSchema },
    ]),
  ],
  controllers: [TitleController],
  providers: [TitleService],
  exports: [TitleService],
})
export class TitleModule {}
