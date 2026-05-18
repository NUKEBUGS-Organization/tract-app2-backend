import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RatingsService } from './ratings.service'
import { CreateRatingDto } from './dto/create-rating.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequireKycApproved } from '../../common/decorators/require-kyc-approved.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { ScoringService } from '../penalties/scoring.service'

@ApiTags('ratings')
@ApiBearerAuth('JWT-auth')
@Controller('ratings')
export class RatingsController {
  constructor(
    private readonly ratingsService: RatingsService,
    private readonly scoringService: ScoringService,
  ) {}

  @Post()
  @RequireKycApproved()
  @ApiOperation({ summary: 'Submit post-close rating (deal parties only)' })
  async createRating(@CurrentUser() user: any, @Body() dto: CreateRatingDto) {
    return this.ratingsService.createRating(user._id.toString(), dto)
  }

  @Get('user/:userId')
  @Public()
  @ApiOperation({ summary: 'Get ratings for a user (public)' })
  async getUserRatings(@Param('userId') userId: string) {
    return this.ratingsService.getUserRatings(userId)
  }

  @Get('score/:userId')
  @ApiOperation({ summary: 'Get reliability score for a user' })
  async getUserScore(@Param('userId') userId: string, @CurrentUser() user: any) {
    if (user._id.toString() !== userId && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('You can only view your own reliability score and penalty history.')
    }
    return this.scoringService.getUserScore(userId)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin removes bad-faith review' })
  async adminRemoveRating(@Param('id') id: string, @CurrentUser() user: any) {
    return this.ratingsService.adminRemoveRating(id, user._id.toString())
  }
}
