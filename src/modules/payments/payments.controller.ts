import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import { PaymentsService } from './payments.service'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { Public } from '../../common/decorators/public.decorator'
import { CapturePaypalOrderDto, CreatePaypalOrderDto } from './dto/paypal.dto'

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Get('deal/:dealId')
  @ApiOperation({ summary: 'Platform fee status for a deal (buyer + lister)' })
  getDealFees(
    @Param('dealId') dealId: string,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.paymentsService.getDealFees(dealId, user._id.toString())
  }

  @Post('paypal/create-order')
  @ApiOperation({ summary: 'Create PayPal order for my pending platform fee' })
  createOrder(
    @Body() dto: CreatePaypalOrderDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.paymentsService.createPayPalOrder(dto.paymentId, user._id.toString())
  }

  @Post('paypal/capture')
  @ApiOperation({ summary: 'Capture PayPal order after buyer approval' })
  capture(
    @Body() dto: CapturePaypalOrderDto,
    @CurrentUser() user: { _id: { toString(): string } },
  ) {
    return this.paymentsService.capturePayPalOrder(
      dto.paymentId,
      user._id.toString(),
      dto.orderId,
    )
  }

  @Public()
  @Post('paypal/webhook')
  @ApiOperation({ summary: 'PayPal webhook (capture completed)' })
  async webhook(
    @Body() body: Record<string, unknown>,
    @Headers('paypal-transmission-id') transmissionId: string | undefined,
  ) {
    const webhookId = this.config.get<string>('paypal.webhookId') ?? ''
    if (webhookId && !transmissionId) {
      throw new UnauthorizedException('Invalid PayPal webhook headers.')
    }
    return this.paymentsService.handlePayPalWebhook(body)
  }
}
