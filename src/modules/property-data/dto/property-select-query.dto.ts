import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator'

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

  @ApiPropertyOptional({ description: 'Street text from the selected prediction, used only if it matches the resolved route' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[^,\r\n\x00-\x1f]+$/)
  selected_street?: string
}
