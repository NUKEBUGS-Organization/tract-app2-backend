import { IsIn, IsOptional, IsBoolean } from 'class-validator'

export class BuyerFailedDto {
  @IsIn(['financing_dropped', 'walked_away', 'failed_inspection'])
  reason: string

  @IsOptional()
  @IsBoolean()
  forfeitEmd?: boolean
}
