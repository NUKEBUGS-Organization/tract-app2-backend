import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TitleController } from './title.controller'
import { TitleService } from './title.service'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'

@Module({
  imports: [MongooseModule.forFeature([{ name: Deal.name, schema: DealSchema }])],
  controllers: [TitleController],
  providers: [TitleService],
  exports: [TitleService],
})
export class TitleModule {}
