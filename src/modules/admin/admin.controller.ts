import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { AdminService } from './admin.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Admin dashboard overview' })
  async getDashboard() {
    return this.adminService.getDashboard()
  }

  @Get('verification-queue')
  @ApiOperation({ summary: 'Get users pending KYC verification' })
  async getVerificationQueue() {
    return this.adminService.getVerificationQueue()
  }

  @Post('verification-queue/:userId/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject KYC' })
  async reviewKyc(@Param('userId') userId: string, @Body() body: { action: 'approve' | 'reject' }) {
    return this.adminService.reviewKyc(userId, body.action)
  }

  @Get('penalties')
  @ApiOperation({ summary: 'Get penalty log' })
  async getPenaltyLog(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getPenaltyLog(page, limit)
  }

  @Post('penalties/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a penalty' })
  async resolvePenalty(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() body: { notes?: string },
  ) {
    return this.adminService.resolvePenalty(id, user._id.toString(), body.notes)
  }

  @Get('users')
  @ApiOperation({ summary: 'List users, optionally by role' })
  async listUsers(@Query('role') role?: string) {
    return this.adminService.listUsers(role)
  }

  @Post('users/:id/ban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ban a user' })
  async banUser(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() body: { reason: string; permanent: boolean; durationDays?: number },
  ) {
    return this.adminService.banUser(id, user._id.toString(), body.reason, body.permanent, body.durationDays)
  }

  @Post('users/:id/unban')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unban a user' })
  async unbanUser(@Param('id') id: string, @CurrentUser() user: { _id: { toString(): string } }) {
    return this.adminService.unbanUser(id, user._id.toString())
  }

  @Get('chat/flagged')
  @ApiOperation({ summary: 'Get flagged messages' })
  async getFlaggedMessages(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getFlaggedMessages(page, limit)
  }

  @Get('financial-ledger')
  @ApiOperation({ summary: 'Get platform financial ledger' })
  async getFinancialLedger(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.adminService.getFinancialLedger(page, limit)
  }

  @Post('listings/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin approve or reject listing' })
  async reviewListing(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() body: { action: 'approve' | 'reject'; reason?: string },
  ) {
    return this.adminService.reviewListing(id, body.action, user._id.toString(), body.reason)
  }

  @Post('users/:id/pof/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve POF' })
  async approvePof(@Param('id') id: string, @CurrentUser() user: { _id: { toString(): string } }) {
    return this.adminService.approvePof(id, user._id.toString())
  }

  @Post('users/:id/pof/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject POF' })
  async rejectPof(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() body: { reason: string },
  ) {
    return this.adminService.rejectPof(id, user._id.toString(), body.reason)
  }
}
