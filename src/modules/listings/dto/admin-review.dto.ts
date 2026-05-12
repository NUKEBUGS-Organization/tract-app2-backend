import { IsIn, IsOptional, IsString } from 'class-validator'

export class AdminReviewDto {
  @IsIn(['approve', 'reject'])
  action: 'approve' | 'reject'

  @IsOptional()
  @IsString()
  reason?: string
}
