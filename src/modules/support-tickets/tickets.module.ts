import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { User, UserSchema } from '../users/schemas/user.schema'
import { NotificationsModule } from '../notifications/notifications.module'
import { TicketsController } from './tickets.controller'
import { TicketsService } from './tickets.service'
import { SupportTicket, SupportTicketSchema } from './schemas/support-ticket.schema'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportTicket.name, schema: SupportTicketSchema },
      { name: User.name, schema: UserSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService],
  exports: [TicketsService],
})
export class TicketsModule {}
