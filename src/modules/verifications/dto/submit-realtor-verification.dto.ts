import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class SubmitRealtorVerificationDto {
  @ApiProperty({ example: 'RE-123456' })
  @IsString()
  @IsNotEmpty()
  state_license_number: string

  @ApiProperty({ example: 'Skyline Realty Group' })
  @IsString()
  @IsNotEmpty()
  brokerage_name: string

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  @IsNotEmpty()
  managing_broker: string

  @ApiProperty({ example: '123 Main St, Suite 400, Austin, TX 78701' })
  @IsString()
  @IsNotEmpty()
  office_address: string
}
