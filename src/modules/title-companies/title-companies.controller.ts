import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { Roles } from '../../common/decorators/roles.decorator'
import { UserRole } from '../../common/enums/user-role.enum'
import { TitleCompaniesService } from './title-companies.service'
import { CreateTitleCompanyDto } from './dto/create-title-company.dto'
import { UpdateTitleCompanyDto } from './dto/update-title-company.dto'

@ApiTags('title-companies')
@ApiBearerAuth('JWT-auth')
@Controller()
export class TitleCompaniesController {
  constructor(private readonly titleCompaniesService: TitleCompaniesService) {}

  @Get('title-companies')
  @ApiOperation({ summary: 'List active title companies (selection dropdown)' })
  listActive() {
    return this.titleCompaniesService.listActive()
  }

  @Get('admin/title-companies')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: list all title companies' })
  listAll() {
    return this.titleCompaniesService.listAll()
  }

  @Post('admin/title-companies')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: create title company' })
  create(@Body() dto: CreateTitleCompanyDto) {
    return this.titleCompaniesService.create(dto)
  }

  @Patch('admin/title-companies/:id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: update or deactivate title company' })
  update(@Param('id') id: string, @Body() dto: UpdateTitleCompanyDto) {
    return this.titleCompaniesService.update(id, dto)
  }
}
