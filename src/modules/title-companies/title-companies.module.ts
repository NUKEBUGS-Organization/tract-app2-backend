import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { TitleCompany, TitleCompanySchema } from './schemas/title-company.schema'
import { TitleCompaniesController } from './title-companies.controller'
import { TitleCompaniesService } from './title-companies.service'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: TitleCompany.name, schema: TitleCompanySchema }]),
  ],
  controllers: [TitleCompaniesController],
  providers: [TitleCompaniesService],
  exports: [TitleCompaniesService],
})
export class TitleCompaniesModule {}
