import { IsString } from 'class-validator'

export class MarketingProofDto {
  @IsString()
  proofUrl: string
}
