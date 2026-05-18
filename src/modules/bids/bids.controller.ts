import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { BidsService } from './bids.service'
import { CreateBidDto } from './dto/create-bid.dto'
import { SelectBidsDto } from './dto/select-bids.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { RequireKycApproved } from '../../common/decorators/require-kyc-approved.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('bids')
@ApiBearerAuth('JWT-auth')
@Controller('bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  // POST /bids — Buyer places a bid
  @Post()
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Place a bid on a listing (Buyer)' })
  async placeBid(@CurrentUser() user: any, @Body() dto: CreateBidDto) {
    return this.bidsService.placeBid(user._id.toString(), dto)
  }

  // GET /bids/mine — Buyer sees their own bids
  @Get('mine')
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  @ApiOperation({ summary: 'Get my bids (Buyer)' })
  async getMyBids(@CurrentUser() user: any) {
    return this.bidsService.getMyBids(user._id.toString())
  }

  // GET /bids/listing/:listingId — Wholesaler sees all bids
  @Get('listing/:listingId')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Get all bids for a listing (Wholesaler)' })
  async getBidsForListing(@Param('listingId') listingId: string, @CurrentUser() user: any) {
    return this.bidsService.getBidsForListing(listingId, user._id.toString(), user.role)
  }

  // POST /bids/listing/:listingId/select — 1-2-Delete rule
  @Post('listing/:listingId/select')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({
    summary: 'Select primary and backup bids — 1-2-Delete rule (Wholesaler)',
  })
  async selectBids(
    @Param('listingId') listingId: string,
    @CurrentUser() user: any,
    @Body() dto: SelectBidsDto,
  ) {
    return this.bidsService.selectBids(listingId, user._id.toString(), dto)
  }

  // PATCH /bids/:bidId/reject — Wholesaler rejects a bid
  @Patch(':bidId/reject')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @RequireKycApproved()
  @ApiOperation({ summary: 'Reject a bid (Wholesaler)' })
  async rejectBid(@Param('bidId') bidId: string, @CurrentUser() user: any) {
    return this.bidsService.rejectBid(bidId, user._id.toString())
  }
}
