import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { ChatGateway } from './chat.gateway'
import { Message, MessageSchema } from './schemas/message.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { PenaltiesModule } from '../penalties/penalties.module'
import { GatewayModule } from '../gateway/gateway.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Message.name, schema: MessageSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
    PenaltiesModule,
    GatewayModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
