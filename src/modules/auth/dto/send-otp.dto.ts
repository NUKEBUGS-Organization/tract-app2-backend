import { IsEmail, IsOptional, IsString, Matches } from 'class-validator'

export class SendOtpDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string

  /** Optional — lets sign-up reject an already-registered phone before sending a code. */
  @IsOptional()
  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Enter a valid phone number (digits or E.164 with +)',
  })
  phone?: string
}
