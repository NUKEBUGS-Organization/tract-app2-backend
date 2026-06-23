import { IsString, IsNumber, IsOptional, Min, IsIn, IsDateString, IsInt, Max } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateBidDto {
  @IsString()
  listingId: string

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  assignmentPrice: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  emdAmount?: number

  @IsOptional()
  @IsDateString()
  proposedClosingDate?: string

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  @Type(() => Number)
  inspectionDays?: number

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
