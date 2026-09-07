import { Body, Controller, Get, Headers, Post, GoneException } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { SkipThrottle } from '@nestjs/throttler'
import { PaymentsService } from './payments.service'
import { SubscriptionsService } from './subscriptions.service'
import { Public } from '../../common/decorators/public.decorator'

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService, private readonly subscriptions: SubscriptionsService) {}

  @Get('deal/:dealId')
  @ApiOperation({ summary: 'Retired transaction billing endpoint', deprecated: true })
  getDealFees() {
    throw new GoneException('Transaction fees are retired. Use your monthly subscription.')
  }

  @Post('paypal/create-order')
  @ApiOperation({ summary: 'Retired transaction billing endpoint', deprecated: true })
  createOrder() {
    throw new GoneException('Transaction fees are retired. Use your monthly subscription.')
  }

  @Post('paypal/capture')
  @ApiOperation({ summary: 'Retired transaction billing endpoint', deprecated: true })
  capture() {
    throw new GoneException('Transaction fees are retired. Use your monthly subscription.')
  }

  @Public()
  @SkipThrottle()
  @Post('paypal/webhook')
  @ApiOperation({ summary: 'Verified PayPal subscription lifecycle webhook' })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.paymentsService.verifyAndHandlePayPalWebhook(body, headers, (event) => this.subscriptions.handleWebhook(event))
  }
}
