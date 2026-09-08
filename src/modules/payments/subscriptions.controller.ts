import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common'
import { Equals, IsString } from 'class-validator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SubscriptionsService, BETA_TERMS_VERSION } from './subscriptions.service'
import { UsageLimitService } from './usage-limit.service'
import type { UsageKind } from './schemas/usage-counter.schema'

class SubscribeDto {
  @IsString()
  @Equals(BETA_TERMS_VERSION)
  termsVersion: string
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly usageLimits: UsageLimitService,
  ) {}

  @Get('me')
  status(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.getStatus(user._id.toString())
  }

  @Get('allowance/:kind')
  allowance(@CurrentUser() user: { _id: { toString(): string } }, @Param('kind') kind: UsageKind) {
    if (kind !== 'listing' && kind !== 'bid') throw new BadRequestException('Unknown allowance kind.')
    return this.usageLimits.getAllowance(user._id.toString(), kind)
  }

  @Post('refresh')
  refresh(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.getStatus(user._id.toString(), true)
  }

  @Post('paypal')
  create(@CurrentUser() user: { _id: { toString(): string } }, @Body() dto: SubscribeDto) {
    return this.subscriptions.create(user._id.toString(), dto.termsVersion)
  }

  @Post('mock-checkout')
  mockCheckout(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.mockCheckout(user._id.toString())
  }

  @Post('cancel')
  cancel(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.cancel(user._id.toString())
  }
}
