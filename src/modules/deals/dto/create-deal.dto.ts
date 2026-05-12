import { IsString, IsNumber, IsOptional, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateDealDto {
  @IsString()
  listingId: string

  @IsString()
  primaryBidId: string

  @IsString()
  primaryBuyerId: string

  @IsString()
  wholesalerId: string

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  emdAmount?: number
}
