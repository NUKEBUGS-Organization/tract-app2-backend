import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from '../users/schemas/user.schema'
import { Verification, VerificationSchema } from './schemas/verification.schema'
import { VerificationsController } from './verifications.controller'
import { VerificationsService } from './verifications.service'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Verification.name, schema: VerificationSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [VerificationsController],
  providers: [VerificationsService],
  exports: [VerificationsService, MongooseModule],
})
export class VerificationsModule {}
