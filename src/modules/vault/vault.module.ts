import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { VaultDocument, VaultDocumentSchema } from './schemas/vault-document.schema'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { VaultService } from './vault.service'
import { VaultController } from './vault.controller'

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: VaultDocument.name, schema: VaultDocumentSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  controllers: [VaultController],
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
