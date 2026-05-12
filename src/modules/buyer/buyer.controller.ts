import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger'
import { BuyerService } from './buyer.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('buyer')
@ApiBearerAuth('JWT-auth')
@Controller('buyer')
export class BuyerController {
  constructor(private readonly buyerService: BuyerService) {}

  @Get('dashboard')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  @ApiOperation({
    summary: 'Get buyer dashboard data',
    description:
      'Returns stats, active bids, deals in progress, and recommended listings for the authenticated buyer.',
  })
  async getDashboard(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.buyerService.getDashboard(user._id.toString())
  }
}
