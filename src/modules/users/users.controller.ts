import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
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
  async getMe(@CurrentUser() user: { _id: { toString(): string } }) {
    const doc = await this.usersService.findById(user._id.toString())
    if (!doc) throw new NotFoundException('User not found.')
    return this.usersService.toPublicUser(doc)
  }

  @Patch('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update profile' })
  async updateProfile(@CurrentUser() user: { _id: { toString(): string } }, @Body() dto: UpdateProfileDto) {
    const updated = await this.usersService.updateProfile(user._id.toString(), dto)
    return this.usersService.toPublicUser(updated)
  }

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'Upload profile picture' })
  async uploadAvatar(
    @CurrentUser() user: { _id: { toString(): string } },
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
  ) {
    const updated = await this.usersService.uploadAvatar(user._id.toString(), file)
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
