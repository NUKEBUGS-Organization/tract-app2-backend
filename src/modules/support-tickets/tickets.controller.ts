import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { CreateTicketDto } from './dto/create-ticket.dto'
import { UpdateTicketDto } from './dto/update-ticket.dto'
import { TicketsService } from './tickets.service'

@ApiTags('tickets')
@ApiBearerAuth('JWT-auth')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a support ticket' })
  create(
    @CurrentUser() user: { _id: { toString(): string }; role: UserRole },
    @Body() dto: CreateTicketDto,
  ) {
    return this.ticketsService.create(user, dto)
  }

  @Get()
  @ApiOperation({ summary: 'List tickets (mine, or all for admin)' })
  list(@CurrentUser() user: { _id: { toString(): string }; role: UserRole }) {
    return this.ticketsService.listForUser(user)
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ticket thread by id' })
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string }; role: UserRole },
  ) {
    return this.ticketsService.findOne(user, id)
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update ticket — status, assign, or reply' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string }; role: UserRole },
    @Body() dto: UpdateTicketDto,
  ) {
    return this.ticketsService.update(user, id, dto)
  }

  @Patch(':id/claim')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Claim ticket (admin only)' })
  claim(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string }; role: UserRole },
  ) {
    return this.ticketsService.claim(user, id)
  }
}
