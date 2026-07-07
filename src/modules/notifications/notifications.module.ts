import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'
import { GatewayModule } from '../gateway/gateway.module'
import { TwilioService } from './twilio.service'
import { ResendService } from './resend.service'
import { NotificationsService } from './notifications.service'
import { NotificationsController } from './notifications.controller'
import { Notification, NotificationSchema } from './schemas/notification.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    GatewayModule,
  ],
  controllers: [NotificationsController],
  providers: [TwilioService, ResendService, NotificationsService],
  exports: [TwilioService, ResendService, NotificationsService],
})
export class NotificationsModule {}
