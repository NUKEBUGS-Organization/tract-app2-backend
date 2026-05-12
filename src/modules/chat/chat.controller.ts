import { Controller, Get, Post, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ChatService } from './chat.service'
import { SendMessageDto } from './dto/send-message.dto'
import { QueryMessagesDto } from './dto/query-messages.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('chat')
@ApiBearerAuth('JWT-auth')
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Send a message',
    description:
      'Chat is locked until deal advances past contract_signed. ' +
      'Anti-circumvention filter blocks phone numbers, emails, and links.',
  })
  async sendMessage(@CurrentUser() user: { _id: { toString(): string }; role: string }, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(user._id.toString(), dto)
  }

  // Static path must be registered before :dealId
  @Get('flagged/all')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all flagged messages (Admin surveillance)' })
  async getFlaggedMessages(@Query() query: QueryMessagesDto) {
    return this.chatService.getFlaggedMessages(query)
  }

  @Get(':dealId')
  @ApiOperation({ summary: 'Get messages for a deal' })
  async getMessages(
    @Param('dealId') dealId: string,
    @CurrentUser() user: { _id: { toString(): string }; role: string },
    @Query() query: QueryMessagesDto,
  ) {
    return this.chatService.getMessages(dealId, user._id.toString(), user.role, query)
  }
}
