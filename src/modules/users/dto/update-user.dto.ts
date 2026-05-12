import { IsOptional, IsString } from 'class-validator'

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  fullName?: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsString()
  stateCode?: string
}
