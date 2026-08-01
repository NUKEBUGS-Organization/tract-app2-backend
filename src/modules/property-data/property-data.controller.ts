import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PropertyDataService } from './property-data.service'
import { PropertyLookupQueryDto } from './dto/property-lookup-query.dto'
import { PropertySearchQueryDto } from './dto/property-search-query.dto'
import { PropertySelectQueryDto } from './dto/property-select-query.dto'

@ApiTags('Property Data')
@ApiBearerAuth('JWT-auth')
@Controller('property-data')
export class PropertyDataController {
  constructor(private readonly propertyDataService: PropertyDataService) {}

  @Get('search')
  @ApiOperation({
    summary:
      'Step 1 — typeahead address search as the user types (Google Places)',
  })
  async search(@Query() query: PropertySearchQueryDto) {
    return this.propertyDataService.searchAddresses(
      query.query,
      query.session_token,
    )
  }

  @Get('select')
  @ApiOperation({
    summary:
      'Step 2 — user picked a suggestion: resolve it and pull ATTOM parcel data to prefill create listing',
  })
  async select(@Query() query: PropertySelectQueryDto) {
    return this.propertyDataService.selectProperty(
      query.place_id,
      query.session_token,
    )
  }

  @Get('lookup')
  @ApiOperation({
    summary: 'Direct lookup by a known address (no search step) — ATTOM only',
  })
  async lookup(@Query() query: PropertyLookupQueryDto) {
    return this.propertyDataService.lookupByAddress(
      query.address1,
      query.address2,
    )
  }
}
