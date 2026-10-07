import { Controller, Get } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { TitleService } from './title.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('title')
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.TITLE_REP)
@Controller('title')
export class TitleController {
  constructor(private readonly titleService: TitleService) {}

  // Steps are advanced through POST /deals/:id/advance so pipeline guards,
  // notifications and closing side-effects stay in one place.
  @Get('dashboard')
  @ApiOperation({
    summary: 'Get title rep dashboard',
    description: 'Deals an admin has assigned to this title representative, with stats.',
  })
  async getDashboard(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.titleService.getDashboard(user._id.toString())
  }
}
