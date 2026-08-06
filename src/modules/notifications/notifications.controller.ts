import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { NotificationsService } from './notifications.service'

@ApiTags('notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (newest first)' })
  listMine(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.notificationsService.listByUser(user._id.toString())
  }

  // Static paths before :id
  @Patch('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  markAllRead(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.notificationsService.markAllRead(user._id.toString())
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all my notifications' })
  clearAll(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.notificationsService.clearAll(user._id.toString())
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.notificationsService.markRead(user._id.toString(), id)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a notification' })
  removeOne(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.notificationsService.removeOne(user._id.toString(), id)
  }
}
