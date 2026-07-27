import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateTitleCompanyDto {
  @IsString()
  @MinLength(2)
  name: string

  @IsEmail()
  contactEmail: string

  @IsOptional()
  @IsString()
  phone?: string

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
