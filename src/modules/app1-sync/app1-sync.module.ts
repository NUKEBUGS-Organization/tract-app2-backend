import { Module } from '@nestjs/common'
import { MongooseModule } from '@nestjs/mongoose'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { App1SyncService } from './app1-sync.service'
import { App1SyncController } from './app1-sync.controller'

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
  ],
  controllers: [App1SyncController],
  providers: [App1SyncService],
  exports: [App1SyncService],
})
export class App1SyncModule {}
