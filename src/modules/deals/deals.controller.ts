import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import type { Response } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { TitleHandlingDto } from './dto/title-handling.dto'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DealsService } from './deals.service'
import { CreateDealDto } from './dto/create-deal.dto'
import { AdvanceStepDto } from './dto/advance-step.dto'
import { BuyerFailedDto } from './dto/buyer-failed.dto'
// import { TitleCompanyDto } from './dto/title-company.dto'
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
  @ApiOperation({
    summary: 'Recover deal for a listing after DocuSeal signing (or return existing)',
    description:
      'Deals are normally created by the DocuSeal webhook when both parties sign. This endpoint only recovers an existing deal or creates one from an already-signed contract.',
  })
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

  // GET /deals/title-requests — Admin queue of buyer-selected title reps.
  // Declared before ':id' so Nest does not match it as a deal id.
  @Get('title-requests')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: deals where the buyer chose TRACT as their title representative',
    description:
      'Only an admin can advance these deals past title search, so they are listed separately with the step each one is waiting on.',
  })
  async titleRepRequests(@CurrentUser() user: any) {
    return this.dealsService.findTitleRepRequests(user.role)
  }

  // GET /deals/:id — Get single deal
  @Get(':id')
  @ApiOperation({ summary: 'Get single deal by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.dealsService.findOne(id, user._id.toString(), user.role)
  }

  // POST /deals/:id/advance — Advance pipeline step
  @Post(':id/title-handling')
  @HttpCode(HttpStatus.OK)
  async chooseTitleHandling(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: TitleHandlingDto) {
    return this.dealsService.chooseTitleHandling(id, user._id.toString(), user.role, dto)
  }

  @Get(':id/title-package')
  async downloadTitlePackage(@Param('id') id: string, @CurrentUser() user: any, @Res() response: Response) {
    const buffer = await this.dealsService.downloadTitlePackage(id, user._id.toString(), user.role)
    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Disposition', `attachment; filename="title-package-${id}.zip"`)
    response.setHeader('Cache-Control', 'private, no-store')
    response.send(buffer)
  }

  @Post(':id/advance')
  @HttpCode(HttpStatus.OK)
  @RequireKycApproved()
  @ApiOperation({
    summary: 'Advance deal pipeline step',
    description:
      'Listing owners advance early steps; buyers advance later steps. ' +
      'When Admin handles title, only admins advance beyond title search.',
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

  // ponytail: re-enable when title company / title rep flow returns
  // @Post(':id/title-company')
  // @HttpCode(HttpStatus.OK)
  // @Roles(UserRole.BUYER, UserRole.REALTOR)
  // @RequireKycApproved()
  // @ApiOperation({ summary: 'Assign title company to deal (Buyer)' })
  // async assignTitleCompany(@Param('id') id: string, @CurrentUser() user: any, @Body() dto: TitleCompanyDto) {
  //   return this.dealsService.assignTitleCompany(id, user._id.toString(), dto)
  // }

  // @Post(':id/notify-title-company')
  // @HttpCode(HttpStatus.OK)
  // @Roles(UserRole.BUYER, UserRole.REALTOR, UserRole.WHOLESALER, UserRole.ADMIN)
  // @RequireKycApproved()
  // @ApiOperation({ summary: 'Email the assigned title company about wire intent' })
  // async notifyTitleCompany(@Param('id') id: string, @CurrentUser() user: any) {
  //   return this.dealsService.notifyTitleCompany(id, user._id.toString(), user.role)
  // }

  // @Post(':id/reassign-title-rep')
  // @HttpCode(HttpStatus.OK)
  // @Roles(UserRole.ADMIN)
  // @ApiOperation({ summary: 'Admin reassigns title rep' })
  // async reassignTitleRep(
  //   @Param('id') id: string,
  //   @CurrentUser() user: any,
  //   @Body() body: { titleRepId: string },
  // ) {
  //   return this.dealsService.reassignTitleRep(id, body.titleRepId, user.role)
  // }

  // POST /deals/:id/marketing-proof — Upload marketing proof PDF
  @Post(':id/marketing-proof')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload marketing proof PDF — cancels kill switch (Wholesaler/Realtor)' })
  async uploadMarketingProof(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    return this.dealsService.uploadMarketingProof(id, user._id.toString(), file)
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
