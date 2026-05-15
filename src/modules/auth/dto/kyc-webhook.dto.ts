import { IsOptional, IsString } from 'class-validator'

/**
 * Thin payload contract (matches tract-app1-style integration).
 * Jumio may send additional fields — they are ignored by ValidationPipe whitelist.
 */
export class KycWebhookDto {
  @IsOptional()
  @IsString()
  customerId?: string

  @IsOptional()
  @IsString()
  customerInternalReference?: string

  @IsOptional()
  @IsString()
  verificationStatus?: string
}
