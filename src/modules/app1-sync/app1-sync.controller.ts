import { Controller, Post, UseGuards } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { InternalGuard } from '../../common/guards/internal.guard'
import { Public } from '../../common/decorators/public.decorator'
import { App1SyncService } from './app1-sync.service'

/**
 * Internal, service-to-service only (x-internal-key). Lets App1 (or an operator)
 * force an immediate App1 -> App2 listing sync instead of waiting for the poller.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalGuard)
@Controller('internal/app1-sync')
export class App1SyncController {
  constructor(private readonly app1SyncService: App1SyncService) {}

  @Post('run')
  run() {
    return this.app1SyncService.syncMarketableDeals()
  }
}
