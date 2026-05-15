import { IsOptional, IsString, IsNumber, IsEnum, Min, IsIn, ValidateIf } from 'class-validator'
import { Type } from 'class-transformer'
import { DealType } from '../../../common/enums/deal-type.enum'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

export class QueryListingsDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v != null)
  @IsString()
  @IsIn(APP2_STATE_CODES, {
    message: 'Listings must be in TX, NJ, NY, MD, DE, FL, or PA.',
  })
  stateCode?: string

  @IsOptional()
  @IsEnum(DealType)
  dealType?: DealType

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minProfit?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxFee?: number

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number
}
