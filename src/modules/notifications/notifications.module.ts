import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TwilioService } from './twilio.service'
import { ResendService } from './resend.service'
import { NotificationsService } from './notifications.service'

@Module({
  imports: [ConfigModule],
  providers: [TwilioService, ResendService, NotificationsService],
  exports: [TwilioService, ResendService, NotificationsService],
})
export class NotificationsModule {}
