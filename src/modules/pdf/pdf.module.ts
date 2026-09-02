import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PdfController } from './pdf.controller'
import { PdfService } from './pdf.service'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Contract, ContractSchema } from '../contracts/schemas/contract.schema'
import { DealsModule } from '../deals/deals.module'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Contract.name, schema: ContractSchema },
    ]),
    DealsModule,
  ],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
