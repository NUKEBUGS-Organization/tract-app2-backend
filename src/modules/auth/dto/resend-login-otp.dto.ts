import { IsEmail } from 'class-validator'

export class ResendLoginOtpDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string
}
