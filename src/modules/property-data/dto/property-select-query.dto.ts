import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class PropertySelectQueryDto {
  @ApiProperty({
    description: 'place_id from the /property-data/search results',
  })
  @IsString()
  @IsNotEmpty()
  place_id!: string

  @ApiPropertyOptional({
    description: 'Same session_token passed to the preceding search calls',
  })
  @IsOptional()
  @IsString()
  session_token?: string
}
