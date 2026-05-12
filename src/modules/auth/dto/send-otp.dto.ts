import { IsEmail, IsString, Matches } from 'class-validator'

export class SendOtpDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, { message: 'Enter a valid phone number' })
  phone: string

  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string
}
