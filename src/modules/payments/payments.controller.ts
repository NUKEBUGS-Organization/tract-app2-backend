import { Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { PaymentsService } from './payments.service'
import { RequireKycApproved } from '../../common/decorators/require-kyc-approved.decorator'

@ApiTags('payments')
@ApiBearerAuth('JWT-auth')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  findAll() {
    return { message: 'payments findAll endpoint ready' }
  }

  @Post('intent')
  @RequireKycApproved()
  @ApiOperation({ summary: 'Create payment intent (stub)' })
  createIntent() {
    return { message: 'payments intent endpoint ready' }
  }
}
