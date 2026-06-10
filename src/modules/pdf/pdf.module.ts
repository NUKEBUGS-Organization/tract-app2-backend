import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { PdfController } from './pdf.controller'
import { PdfService } from './pdf.service'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'

@Module({
  imports: [MongooseModule.forFeature([{ name: Deal.name, schema: DealSchema }])],
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
