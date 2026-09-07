import { Body, Controller, Get, Post } from '@nestjs/common'
import { Equals, IsString } from 'class-validator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { SubscriptionsService, BETA_TERMS_VERSION } from './subscriptions.service'

class SubscribeDto {
  @IsString()
  @Equals(BETA_TERMS_VERSION)
  termsVersion: string
}

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get('me')
  status(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.getStatus(user._id.toString())
  }

  @Post('refresh')
  refresh(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.getStatus(user._id.toString(), true)
  }

  @Post('paypal')
  create(@CurrentUser() user: { _id: { toString(): string } }, @Body() dto: SubscribeDto) {
    return this.subscriptions.create(user._id.toString(), dto.termsVersion)
  }

  @Post('cancel')
  cancel(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.subscriptions.cancel(user._id.toString())
  }
}
