import { Module } from '@nestjs/common'
import { PropertyDataController } from './property-data.controller'
import { PropertyDataService } from './property-data.service'
import { GooglePlacesService } from './google-places.service'

@Module({
  controllers: [PropertyDataController],
  providers: [PropertyDataService, GooglePlacesService],
  exports: [PropertyDataService],
})
export class PropertyDataModule {}
