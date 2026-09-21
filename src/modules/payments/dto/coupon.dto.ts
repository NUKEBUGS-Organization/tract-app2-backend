import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator'

export class CouponCodeDto {
  @ApiProperty({
    example: 'BETA100',
    description: 'Coupon code. Case-insensitive; letters, digits and hyphens only.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]*$/, {
    message: 'Coupon codes contain only letters, digits and hyphens.',
  })
  code!: string
}
