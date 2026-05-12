import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { DealsService } from './deals.service'
import { CreateDealDto } from './dto/create-deal.dto'
import { AdvanceStepDto } from './dto/advance-step.dto'
import { BuyerFailedDto } from './dto/buyer-failed.dto'
import { TitleCompanyDto } from './dto/title-company.dto'
import { MarketingProofDto } from './dto/marketing-proof.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  // POST /deals — Create deal after bid selection
  @Post()
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR, UserRole.ADMIN)
  async createDeal(@CurrentUser() user: any, @Body() dto: CreateDealDto) {
    return this.dealsService.createDeal(dto, user._id.toString(), user.role)
  }

  // GET /deals — Get my deals
  @Get()
  async getMyDeals(@CurrentUser() user: any) {
    return this.dealsService.findMyDeals(user._id.toString(), user.role)
  }

  // GET /deals/:id — Get single deal
  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dealsService.findOne(id, user._id.toString(), user.role)
  }

  // POST /deals/:id/advance — Advance pipeline step
  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  async advanceStep(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: AdvanceStepDto) {
    return this.dealsService.advanceStep(id, user._id.toString(), user.role, dto)
  }

  // POST /deals/:id/buyer-failed — Buyer failed to close
  @Post(':id/buyer-failed')
  @HttpCode(HttpStatus.OK)
  async buyerFailed(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: BuyerFailedDto) {
    return this.dealsService.buyerFailed(id, user._id.toString(), user.role, dto)
  }

  // POST /deals/:id/title-company — Assign title company
  @Post(':id/title-company')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  async assignTitleCompany(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: TitleCompanyDto) {
    return this.dealsService.assignTitleCompany(id, user._id.toString(), dto)
  }

  // POST /deals/:id/marketing-proof — Upload marketing proof
  @Post(':id/marketing-proof')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
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
  async freezeDeal(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dealsService.freezeDeal(id, user._id.toString())
  }
}
