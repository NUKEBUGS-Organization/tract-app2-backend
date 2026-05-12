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
import { BidsService } from './bids.service'
import { CreateBidDto } from './dto/create-bid.dto'
import { SelectBidsDto } from './dto/select-bids.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@Controller('bids')
export class BidsController {
  constructor(private readonly bidsService: BidsService) {}

  // POST /bids — Buyer places a bid
  @Post()
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  async placeBid(@CurrentUser() user: any, @Body() dto: CreateBidDto) {
    return this.bidsService.placeBid(user._id.toString(), dto)
  }

  // GET /bids/mine — Buyer sees their own bids
  @Get('mine')
  @Roles(UserRole.BUYER, UserRole.REALTOR)
  async getMyBids(@CurrentUser() user: any) {
    return this.bidsService.getMyBids(user._id.toString())
  }

  // GET /bids/listing/:listingId — Wholesaler sees all bids
  @Get('listing/:listingId')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR, UserRole.ADMIN)
  async getBidsForListing(@Param('listingId') listingId: string, @CurrentUser() user: any) {
    return this.bidsService.getBidsForListing(listingId, user._id.toString(), user.role)
  }

  // POST /bids/listing/:listingId/select — 1-2-Delete rule
  @Post('listing/:listingId/select')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
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
  async rejectBid(@Param('bidId') bidId: string, @CurrentUser() user: any) {
    return this.bidsService.rejectBid(bidId, user._id.toString())
  }
}
