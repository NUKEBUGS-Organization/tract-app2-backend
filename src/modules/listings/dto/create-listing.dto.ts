import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  IsObject,
  IsIn,
  ValidateIf,
} from 'class-validator'
import { Type } from 'class-transformer'
import { DealType } from '../../../common/enums/deal-type.enum'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

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
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsIn(APP2_STATE_CODES, {
    message: 'Listings must be in TX, NJ, NY, MD, DE, FL, or PA.',
  })
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
