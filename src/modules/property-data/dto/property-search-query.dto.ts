import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator'

export class PropertySearchQueryDto {
  @ApiProperty({
    example: '432 Win',
    description: 'Partial address as the user types',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  query!: string

  @ApiPropertyOptional({
    description:
      'Client-generated UUID, reused across a search session and the final select call, to keep Google Places billing to one session instead of per-request',
  })
  @IsOptional()
  @IsString()
  session_token?: string
}
