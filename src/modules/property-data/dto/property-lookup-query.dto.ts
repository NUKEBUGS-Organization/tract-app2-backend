import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty, IsString } from 'class-validator'

export class PropertyLookupQueryDto {
  @ApiProperty({
    example: '123 Main St',
    description: 'Street address, e.g. house number and route',
  })
  @IsString()
  @IsNotEmpty()
  address1!: string

  @ApiProperty({
    example: 'Austin, TX 78701',
    description: 'City, state and ZIP',
  })
  @IsString()
  @IsNotEmpty()
  address2!: string
}
