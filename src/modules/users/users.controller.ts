import { Controller, Get, Post, Body, Param } from '@nestjs/common'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { ScoringService } from '../penalties/scoring.service'
import { ApplyPenaltyDto } from './dto/apply-penalty.dto'

@Controller('users')
export class UsersController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get('me')
  getMe(@CurrentUser() user: unknown) {
    return user
  }

  @Get('me/score')
  getMyScore(@CurrentUser() user: any) {
    return this.scoringService.getUserScore(user._id.toString())
  }

  @Post(':id/penalty')
  @Roles(UserRole.ADMIN)
  applyPenalty(@Param('id') id: string, @Body() dto: ApplyPenaltyDto) {
    return this.scoringService.applyViolation(id, dto.violationType, {
      dealId: dto.dealId,
      listingId: dto.listingId,
      notes: dto.notes,
    })
  }
}
