import { IsString, IsArray, IsOptional, ArrayMaxSize } from 'class-validator'

export class SelectBidsDto {
  // primaryBidId is the #1 selection — goes under contract
  @IsString()
  primaryBidId: string

  // Up to 2 backup bid IDs (optional)
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2)
  backupBidIds?: string[]
}
