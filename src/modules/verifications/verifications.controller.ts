import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { SubmitRealtorVerificationDto } from './dto/submit-realtor-verification.dto'
import { VerificationsService } from './verifications.service'

@ApiTags('verifications')
@ApiBearerAuth('JWT-auth')
@Controller('verifications')
export class VerificationsController {
  constructor(private readonly verificationsService: VerificationsService) {}

  @Post('realtor')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.REALTOR)
  @ApiOperation({ summary: 'Submit/resubmit realtor license verification' })
  async submitRealtor(
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() dto: SubmitRealtorVerificationDto,
  ) {
    return this.verificationsService.submitRealtorVerification(user._id.toString(), dto)
  }

  @Get('me')
  @Roles(UserRole.REALTOR)
  @ApiOperation({ summary: 'Get own realtor verification status' })
  async getMine(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.verificationsService.getMyVerification(user._id.toString())
  }
}
