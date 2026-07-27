import { Controller, Get, Param, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { InternalGuard } from '../../common/guards/internal.guard'
import { Public } from '../../common/decorators/public.decorator'
import { ListingsService } from './listings.service'

@ApiExcludeController()
@Public()
@UseGuards(InternalGuard)
@Controller('internal/listings')
export class InternalListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  @Get('by-app1-deal/:app1DealId')
  getByApp1Deal(@Param('app1DealId') app1DealId: string) {
    return this.listingsService.getStatusByApp1DealId(app1DealId)
  }
}
