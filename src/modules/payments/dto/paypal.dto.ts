import { IsOptional, IsString } from 'class-validator'

export class CreatePaypalOrderDto {
  @IsString()
  paymentId: string
}

export class CapturePaypalOrderDto {
  @IsString()
  paymentId: string

  @IsOptional()
  @IsString()
  orderId?: string
}
