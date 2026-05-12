import { IsEmail } from 'class-validator'

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string
}
