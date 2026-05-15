import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { WholesalerController } from './wholesaler.controller'
import { WholesalerService } from './wholesaler.service'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { User, UserSchema } from '../users/schemas/user.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: Deal.name, schema: DealSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WholesalerController],
  providers: [WholesalerService],
  exports: [WholesalerService],
})
export class WholesalerModule {}
