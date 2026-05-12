import { IsString, IsEmail, IsOptional } from 'class-validator'

export class TitleCompanyDto {
  @IsString()
  titleCompanyName: string

  @IsEmail()
  titleCompanyEmail: string

  @IsOptional()
  @IsString()
  emdWiringInstructions?: string

  @IsOptional()
  @IsString()
  titleRepId?: string
}
