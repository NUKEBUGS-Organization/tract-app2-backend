import { IsString, IsIn } from 'class-validator'

export class SubmitPofDto {
  @IsString()
  @IsIn(['proof_of_funds', 'bank_approval', 'transactional_funding'])
  documentType: string

  @IsString()
  documentUrl: string
}
