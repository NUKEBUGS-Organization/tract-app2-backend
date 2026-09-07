import { IsBoolean, IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator'
import { Transform } from 'class-transformer'

export class CreateContractDto {
  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  realtorSigned?: boolean

  @IsMongoId()
  bidId!: string

  @IsOptional()
  @IsString()
  purchaserAddress?: string

  @IsOptional()
  @IsString()
  propertyBlock?: string

  @IsOptional()
  @IsString()
  propertyLot?: string

  @IsOptional()
  @IsNumber()
  emdAmount?: number

  @IsOptional()
  @IsNumber()
  closingDays?: number

  /** Feasibility / inspection period in calendar days (default 45). */
  @IsOptional()
  @IsNumber()
  feasibilityDays?: number
}
