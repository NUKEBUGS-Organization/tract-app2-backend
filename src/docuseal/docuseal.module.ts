import { Module } from '@nestjs/common'
import { DocuSealService } from './docuseal.service'

@Module({
  providers: [DocuSealService],
  exports: [DocuSealService],
})
export class DocuSealModule {}
