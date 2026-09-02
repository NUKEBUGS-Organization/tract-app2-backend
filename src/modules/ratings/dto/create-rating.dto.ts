import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  MaxLength,
  IsMongoId,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateRatingDto {
  @IsMongoId()
  dealId: string

  // Whole stars only, 1–5. Was @IsNumber, which let 3.7★ through to storage.
  @IsInt()
  @Min(1)
  @Max(5)
  @Type(() => Number)
  stars: number

  // Mirrors the Mongoose schema's maxlength:1000 — without this the schema
  // validator throws and surfaces as an unhandled 500 instead of a 400.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string
}
