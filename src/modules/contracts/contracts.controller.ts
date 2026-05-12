import { Controller, Get, Param } from '@nestjs/common'
import { ContractsService } from './contracts.service'

@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  findAll() {
    return { message: 'contracts findAll endpoint ready' }
  }

  @Get(':id')
  findOne(@Param('id') _id: string) {
    return { message: 'contracts findOne endpoint ready' }
  }
}
