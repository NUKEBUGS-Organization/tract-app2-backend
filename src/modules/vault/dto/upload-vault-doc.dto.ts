import { IsString, IsIn, IsOptional } from 'class-validator'

export class UploadVaultDocDto {
  @IsString()
  fileName: string

  @IsString()
  fileUrl: string

  @IsOptional()
  @IsIn(['document', 'inspection', 'contract', 'disclosure', 'title', 'other'])
  fileType?: string

  @IsOptional()
  @IsIn(['all', 'buyer', 'wholesaler', 'title_rep', 'admin'])
  visibleTo?: string
}
