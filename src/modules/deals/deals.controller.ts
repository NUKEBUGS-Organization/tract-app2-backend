import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DealsService } from './deals.service'
import { CreateDealDto } from './dto/create-deal.dto'
import { AdvanceStepDto } from './dto/advance-step.dto'
import { BuyerFailedDto } from './dto/buyer-failed.dto'
import { TitleCompanyDto } from './dto/title-company.dto'
import { MarketingProofDto } from './dto/marketing-proof.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequireKycApproved } from '../../common/decorators/require-kyc-approved.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('deals')
@ApiBearerAuth('JWT-auth')
@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // POST /deals — Create deal after bid selection
  @Post()
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR, UserRole.ADMIN)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Create deal after bid selection' })
  async createDeal(@CurrentUser() user: any, @Body() dto: CreateDealDto) {
    return this.dealsService.createDeal(dto, user._id.toString(), user.role)
  }

  // GET /deals — Get my deals
  @Get()
  @ApiOperation({ summary: 'Get my deals' })
  async getMyDeals(
    @CurrentUser() user: any,
    @Query('listingId') listingId?: string,
  ) {
    return this.dealsService.findMyDeals(
      user._id.toString(),
      user.role,
      listingId,
    )
  }

  // GET /deals/:id — Get single deal
  @Get(':id')
  @ApiOperation({ summary: 'Get single deal by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dealsService.findOne(id, user._id.toString(), user.role)
  }

  // POST /deals/:id/advance — Advance pipeline step
  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @RequireKycApproved()
  @ApiOperation({
    summary: 'Advance deal pipeline step',
    description:
      'Steps 1-3 can be advanced by Buyer or Wholesaler. ' +
      'Steps 4-8 require Title Representative.',
  })
  async advanceStep(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AdvanceStepDto) {
    return this.dealsService.advanceStep(id, user._id.toString(), user.role, dto)
  }

  // POST /deals/:id/buyer-failed — Buyer failed to close
  @Post(':id/buyer-failed')
  @HttpCode(HttpStatus.OK)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Mark buyer as failed — triggers backup promotion' })
  async buyerFailed(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: BuyerFailedDto) {
    return this.dealsService.buyerFailed(id, user._id.toString(), user.role, dto)
  }

  // POST /deals/:id/title-company — Assign title company
  @Post(':id/title-company')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Assign title company to deal (Buyer)' })
  async assignTitleCompany(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: TitleCompanyDto) {
    return this.dealsService.assignTitleCompany(id, user._id.toString(), dto)
  }

  @Post(':id/reassign-title-rep')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin reassigns title rep' })
  async reassignTitleRep(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() body: { titleRepId: string },
  ) {
    return this.dealsService.reassignTitleRep(id, body.titleRepId, user.role)
  }

  // POST /deals/:id/marketing-proof — Upload marketing proof
  @Post(':id/marketing-proof')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Upload marketing proof — cancels kill switch (Wholesaler)' })
  async uploadMarketingProof(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: MarketingProofDto,
  ) {
    return this.dealsService.uploadMarketingProof(id, user._id.toString(), dto.proofUrl)
  }

  // POST /deals/:id/freeze — Admin freezes deal
  @Post(':id/freeze')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Freeze deal due to dispute (Admin)' })
  async freezeDeal(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dealsService.freezeDeal(id, user._id.toString())
  }
}
