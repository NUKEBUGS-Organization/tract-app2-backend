import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { ScoringService } from '../penalties/scoring.service'
import { ApplyPenaltyDto } from './dto/apply-penalty.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'
import { SubmitPofDto } from './dto/submit-pof.dto'
import { UsersService } from './users.service'

@ApiTags('users')
@ApiBearerAuth('JWT-auth')
@Controller('users')
export class UsersController {
  constructor(
    private readonly scoringService: ScoringService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get my profile' })
  getMe(@CurrentUser() user: unknown) {
    return user
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update profile' })
  async updateProfile(@CurrentUser() user: { _id: { toString(): string } }, @Body() dto: UpdateProfileDto) {
    const updated = await this.usersService.updateProfile(user._id.toString(), dto)
    return this.usersService.toPublicUser(updated)
  }

  @Post('me/pof')
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit proof of funds' })
  async submitPof(@CurrentUser() user: { _id: { toString(): string } }, @Body() dto: SubmitPofDto) {
    return this.usersService.submitPof(user._id.toString(), dto)
  }

  @Get('me/score')
  @ApiOperation({ summary: 'Get my reliability score and penalty history' })
  getMyScore(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.scoringService.getUserScore(user._id.toString())
  }

  @Post(':id/penalty')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Apply penalty to user (Admin only)' })
  applyPenalty(@Param('id') id: string, @Body() dto: ApplyPenaltyDto) {
    return this.scoringService.applyViolation(id, dto.violationType, {
      dealId: dto.dealId,
      listingId: dto.listingId,
      notes: dto.notes,
    })
  }
}
