import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Penalty, PenaltySchema } from '../penalties/schemas/penalty.schema'
import { Message, MessageSchema } from '../chat/schemas/message.schema'
import { Rating, RatingSchema } from '../ratings/schemas/rating.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: Deal.name, schema: DealSchema },
      { name: User.name, schema: UserSchema },
      { name: Penalty.name, schema: PenaltySchema },
      { name: Message.name, schema: MessageSchema },
      { name: Rating.name, schema: RatingSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
