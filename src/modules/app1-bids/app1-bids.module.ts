import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { App1BidsService } from './app1-bids.service'

@Module({
  imports: [ConfigModule],
  providers: [App1BidsService],
  exports: [App1BidsService],
})
export class App1BidsModule {}
