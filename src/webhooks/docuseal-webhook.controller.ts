import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from '../common/decorators/public.decorator'
import { ContractsService } from '../modules/contracts/contracts.service'

@ApiExcludeController()
@Public()
@Controller('webhooks/docuseal-app2')
export class DocuSealWebhookController {
  private readonly logger = new Logger(DocuSealWebhookController.name)

  constructor(private readonly contractsService: ContractsService) {}

  @Post(':secret')
  @HttpCode(HttpStatus.OK)
  async handleEvent(@Param('secret') secret: string, @Body() body: any) {
    this.logger.log(
      `DocuSeal webhook received: event_type=${body?.event_type}, external_id=${body?.data?.external_id}`,
    )

    return this.contractsService.handleDocuSealWebhook(secret, body)
  }
}
