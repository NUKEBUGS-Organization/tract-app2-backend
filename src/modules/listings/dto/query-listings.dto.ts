import { IsOptional, IsString, IsNumber, IsEnum, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { DealType } from '../../../common/enums/deal-type.enum'

export class QueryListingsDto {
  @IsOptional()
  @IsString()
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
