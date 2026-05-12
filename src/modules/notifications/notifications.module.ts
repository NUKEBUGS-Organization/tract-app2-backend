import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { TwilioService } from './twilio.service'
import { MailService } from './mail.service'
import { NotificationsService } from './notifications.service'

@Module({
  imports: [ConfigModule],
  providers: [TwilioService, MailService, NotificationsService],
  exports: [TwilioService, MailService, NotificationsService],
})
export class NotificationsModule {}
