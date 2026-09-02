import { IsString, IsIn, IsOptional, IsUrl, MaxLength } from 'class-validator'

export class UploadVaultDocDto {
  @IsString()
  @MaxLength(255)
  fileName: string

  // Must be a real http(s) URL — blocks javascript:/data:/file: URIs that would
  // otherwise be stored and rendered as a clickable link to the other party.
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  @MaxLength(2048)
  fileUrl: string

  @IsOptional()
  @IsIn(['document', 'inspection', 'contract', 'disclosure', 'title', 'other'])
  fileType?: string

  @IsOptional()
  @IsIn(['all', 'buyer', 'wholesaler', 'title_rep', 'admin'])
  visibleTo?: string
}
