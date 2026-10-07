import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

export class CreateTitleRepDto {
  @IsString()
  @MinLength(2, { message: 'Full name must be at least 2 characters' })
  fullName: string

  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string

  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Enter a valid phone number (digits or E.164 with +)',
  })
  phone: string

  @IsOptional()
  @IsString()
  @IsIn(APP2_STATE_CODES, {
    message: 'TRACT App 2 currently operates in TX, NJ, NY, MD, DE, FL, and PA only.',
  })
  stateCode?: string
}
