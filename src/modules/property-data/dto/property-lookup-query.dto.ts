import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class PropertyLookupQueryDto {
  @ApiProperty({
    example: '123 Main St',
    description: 'Street address (ATTOM address1)',
  })
  @IsString()
  @IsNotEmpty()
  address1!: string

  @ApiProperty({
    example: 'Austin, TX 78701',
    description: 'City, state, zip (ATTOM address2)',
  })
  @IsString()
  @IsNotEmpty()
  address2!: string
}
