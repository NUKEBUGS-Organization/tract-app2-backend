import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { FAQ_CATEGORIES }
  from '../../../common/constants/faq-categories'

export class UpdateFaqDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(10000)
  answer?: string

  @ApiPropertyOptional({ enum: FAQ_CATEGORIES })
  @IsOptional()
  @IsIn([...FAQ_CATEGORIES])
  @IsString()
  category?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean
}
