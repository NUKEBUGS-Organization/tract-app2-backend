import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { Payment, PaymentSchema } from './schemas/payment.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Listing.name, schema: ListingSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
