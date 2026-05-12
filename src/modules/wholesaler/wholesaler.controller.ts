import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { WholesalerService } from './wholesaler.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('wholesaler')
@ApiBearerAuth('JWT-auth')
@Controller('wholesaler')
export class WholesalerController {
  constructor(private readonly wholesalerService: WholesalerService) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @ApiOperation({
    summary: 'Get wholesaler dashboard data',
    description:
      'Returns aggregated stats, kill switch alerts, active deal pipeline, and listings for the authenticated wholesaler.',
  })
  async getDashboard(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.wholesalerService.getDashboard(user._id.toString())
  }
}
