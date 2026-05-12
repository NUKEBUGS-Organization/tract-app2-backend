import { IsEnum, IsOptional, IsMongoId, IsString } from 'class-validator'
import { ViolationType } from '../../penalties/schemas/penalty.schema'

export class ApplyPenaltyDto {
  @IsEnum(ViolationType)
  violationType: ViolationType

  @IsOptional()
  @IsMongoId()
  dealId?: string

  @IsOptional()
  @IsMongoId()
  listingId?: string

  @IsOptional()
  @IsString()
  notes?: string
}
