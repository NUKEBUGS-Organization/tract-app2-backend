import { IsEmail } from 'class-validator'

export class SendOtpDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string
}
