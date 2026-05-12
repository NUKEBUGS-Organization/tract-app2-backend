import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  IsObject,
  IsIn,
} from 'class-validator'
import { Type } from 'class-transformer'
import { DealType } from '../../../common/enums/deal-type.enum'

export class CreateListingDto {
  @IsEnum(DealType)
  dealType: DealType

  @IsOptional()
  @IsIn(['off_market', 'on_market'])
  marketStatus?: string

  @IsOptional()
  @IsString()
  propertyAddress?: string

  @IsOptional()
  @IsString()
  city?: string

  @IsOptional()
  @IsString()
  stateCode?: string

  @IsOptional()
  @IsString()
  zipCode?: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  arv?: number

  @IsOptional()
  @IsObject()
  rehabBreakdown?: Record<string, number>

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  rehabTotal?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  purchasePrice?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  estimatedHoldingCosts?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  assignmentFeeLow?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  assignmentFeeHigh?: number
}
