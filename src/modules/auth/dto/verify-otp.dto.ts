import { IsString, Length, IsEmail } from 'class-validator'

export class VerifyOtpDto {
  @IsEmail()
  email: string

  @IsString()
  @Length(6, 6, { message: 'Email OTP must be 6 digits' })
  emailOtp: string
}
