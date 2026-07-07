import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator'
import { FAQ_CATEGORIES }
  from '../../../common/constants/faq-categories'

export class CreateFaqDto {
  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question: string

  @ApiProperty()
  @IsString()
  @MinLength(3)
  @MaxLength(10000)
  answer: string

  @ApiProperty({ enum: FAQ_CATEGORIES })
  @IsIn([...FAQ_CATEGORIES])
  @IsString()
  category: string

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean
}
