import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { RatingsController } from './ratings.controller'
import { RatingsService } from './ratings.service'
import { Rating, RatingSchema } from './schemas/rating.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { User, UserSchema } from '../users/schemas/user.schema'
import { PenaltiesModule } from '../penalties/penalties.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Rating.name, schema: RatingSchema },
      { name: Deal.name, schema: DealSchema },
      { name: User.name, schema: UserSchema },
    ]),
    PenaltiesModule,
  ],
  controllers: [RatingsController],
  providers: [RatingsService],
  exports: [RatingsService],
})
export class RatingsModule {}
