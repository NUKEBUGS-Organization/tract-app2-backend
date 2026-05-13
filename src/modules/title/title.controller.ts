import { Controller, Get, Post, Param, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { TitleService } from './title.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('title')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.TITLE_REP, UserRole.ADMIN)
@Controller('title')
export class TitleController {
  constructor(private readonly titleService: TitleService) {}

  @Get('dashboard')
  @ApiOperation({
    summary: 'Get title rep dashboard',
    description: 'Returns active deals, pending EMDs, and stats for the title representative.',
  })
  async getDashboard(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.titleService.getDashboard(user._id.toString())
  }

  @Post('deals/:dealId/advance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advance a deal to the next step',
    description: 'Title rep can only advance into steps 4–8 (per pipeline rules).',
  })
  async advanceStep(@Param('dealId') dealId: string, @CurrentUser() user: { _id: { toString(): string } }) {
    return this.titleService.advanceStep(dealId, user._id.toString())
  }

  @Post('deals/:dealId/confirm-emd')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm EMD receipt' })
  async confirmEmd(@Param('dealId') dealId: string, @CurrentUser() user: { _id: { toString(): string } }) {
    return this.titleService.confirmEmd(dealId, user._id.toString())
  }
}
