import { IsString, Length, IsEmail, Matches } from 'class-validator'

export class VerifyOtpDto {
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Enter a valid phone number',
  })
  phone: string

  @IsEmail()
  email: string

  @IsString()
  @Length(6, 6, { message: 'SMS OTP must be 6 digits' })
  smsOtp: string

  @IsString()
  @Length(6, 6, { message: 'Email OTP must be 6 digits' })
  emailOtp: string
}
