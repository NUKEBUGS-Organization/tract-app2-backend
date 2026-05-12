import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsMongoId,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateRatingDto {
  @IsMongoId()
  dealId: string

  @IsNumber()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  stars: number

  @IsOptional()
  @IsString()
  comment?: string
}
