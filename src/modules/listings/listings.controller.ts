import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ListingsService } from './listings.service'
import { CreateListingDto } from './dto/create-listing.dto'
import { UpdateListingDto } from './dto/update-listing.dto'
import { QueryListingsDto } from './dto/query-listings.dto'
import { AdminReviewDto } from './dto/admin-review.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequireKycApproved } from '../../common/decorators/require-kyc-approved.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('listings')
@ApiBearerAuth('JWT-auth')
@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  // ── POST /listings — Wholesaler creates a draft ──────────────
  @Post()
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Create a draft listing (Wholesaler)' })
  async create(@CurrentUser() user: any, @Body() dto: CreateListingDto) {
    return this.listingsService.create(user._id.toString(), dto)
  }

  // ── GET /listings — Live stream for buyers ───────────────────
  @Get()
  @Public()
  @ApiOperation({ summary: 'Get live marketplace listings (public)' })
  async findLive(@Query() query: QueryListingsDto) {
    return this.listingsService.findLive(query)
  }

  // ── GET /listings/mine — Wholesaler's own listings ───────────
  @Get('mine')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @ApiOperation({ summary: 'Get my own listings (Wholesaler)' })
  async findMine(@CurrentUser() user: any) {
    return this.listingsService.findMyListings(user._id.toString())
  }

  // ── GET /listings/pending-review — Admin only ────────────────
  @Get('pending-review')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Get listings pending compliance (Admin)' })
  async findPendingReview() {
    return this.listingsService.findPendingReview()
  }

  // ── GET /listings/:id — Single listing ──────────────────────
  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get single listing by ID' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { role?: string } | undefined) {
    const role = user?.role ?? UserRole.BUYER
    return this.listingsService.findOne(id, role)
  }

  // ── PATCH /listings/:id — Update draft ───────────────────────
  @Patch(':id')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Update a draft listing (Wholesaler)' })
  async update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, user._id.toString(), dto)
  }

  // ── POST /listings/:id/publish — Submit for review ──────────
  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Publish listing to marketplace' })
  async publish(@Param('id') id: string, @CurrentUser() user: any) {
    return this.listingsService.publish(id, user._id.toString())
  }

  // ── POST /listings/:id/admin-review — Admin approve/reject ──
  @Post(':id/admin-review')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin approve or reject listing' })
  async adminReview(@Param('id') id: string, @Body() body: AdminReviewDto) {
    return this.listingsService.adminReview(id, body.action, body.reason)
  }
}
