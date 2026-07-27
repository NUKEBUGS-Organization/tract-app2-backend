import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ContractsService } from './contracts.service'
import { CreateContractDto } from './dto/create-contract.dto'
import { MyContractsQueryDto } from './dto/my-contracts-query.dto'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'

@ApiTags('contracts')
@ApiBearerAuth('JWT-auth')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Post('listing/:listingId')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR)
  @ApiOperation({ summary: 'Create a contract and DocuSeal submission' })
  createContract(
    @Param('listingId') listingId: string,
    @Body() dto: CreateContractDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.contractsService.createContract(listingId, user._id.toString(), dto)
  }

  @Get('my-contracts')
  @ApiOperation({ summary: 'Contracts where the caller is lister or purchaser' })
  myContracts(
    @CurrentUser() user: { _id: { toString(): string } },
    @Query() query: MyContractsQueryDto,
  ) {
    return this.contractsService.myContracts(user._id.toString(), query)
  }

  @Get('listing/:listingId')
  @Roles(UserRole.WHOLESALER, UserRole.REALTOR, UserRole.BUYER)
  @ApiOperation({ summary: 'Get contract for a listing if one exists' })
  getByListing(
    @Param('listingId') listingId: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.contractsService.getContractByListing(
      listingId,
      user._id.toString(),
    )
  }

  @Get(':id/sign-url')
  @ApiOperation({ summary: 'Get DocuSeal signing URL for the current user' })
  getSignUrl(
    @Param('id') id: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.contractsService.getSignUrl(id, user._id.toString())
  }
}
