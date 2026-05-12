import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ConfigModule } from '@nestjs/config'
import { ScoringService } from './scoring.service'
import { Penalty, PenaltySchema } from './schemas/penalty.schema'
import { User, UserSchema } from '../users/schemas/user.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Penalty.name, schema: PenaltySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  providers: [ScoringService],
  exports: [ScoringService],
})
export class PenaltiesModule {}
