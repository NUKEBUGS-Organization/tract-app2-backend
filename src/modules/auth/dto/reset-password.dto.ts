import { IsEmail, IsString, Length, MinLength } from 'class-validator'

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string

  @IsString()
  @Length(6, 6, { message: 'Invalid reset token' })
  token: string

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  newPassword: string
}
