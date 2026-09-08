import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PaymentsController } from './payments.controller'
import { PaymentsService } from './payments.service'
import { Payment, PaymentSchema } from './schemas/payment.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Subscription, SubscriptionSchema } from './schemas/subscription.schema'
import { SubscriptionsService } from './subscriptions.service'
import { SubscriptionsController } from './subscriptions.controller'
import { UsageCounter, UsageCounterSchema } from './schemas/usage-counter.schema'
import { UsageLimitService } from './usage-limit.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Listing.name, schema: ListingSchema },
      { name: User.name, schema: UserSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: UsageCounter.name, schema: UsageCounterSchema },
    ]),
  ],
  controllers: [PaymentsController, SubscriptionsController],
  providers: [PaymentsService, SubscriptionsService, UsageLimitService],
  exports: [PaymentsService, SubscriptionsService, UsageLimitService],
})
export class PaymentsModule {}
