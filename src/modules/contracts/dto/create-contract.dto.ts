import { IsMongoId, IsNumber, IsOptional, IsString } from 'class-validator'

export class CreateContractDto {
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
}
