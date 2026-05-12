import { IsString, IsNumber, IsOptional, Min, IsIn } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateBidDto {
  @IsString()
  listingId: string

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  assignmentPrice: number

  @IsOptional()
  @IsString()
  specialTerms?: string

  // Realtor fields (optional)
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  commissionPct?: number

  @IsOptional()
  @IsIn(['buyers_agent', 'transaction_coordinator'])
  agencyRole?: string

  @IsOptional()
  @IsIn(['seller', 'buyer'])
  feePaidBy?: string
}
