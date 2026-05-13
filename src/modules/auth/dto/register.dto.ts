import {
  IsEmail, IsString, IsEnum,
  MinLength, IsDateString, Matches, IsIn,
} from 'class-validator'
import { UserRole } from '../../../common/enums/user-role.enum'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

export class RegisterDto {
  @IsString()
  @MinLength(2)
  fullName: string

  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string

  @IsString()
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Enter a valid phone number (digits or E.164 with +)',
  })
  phone: string

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain at least 1 uppercase letter and 1 number',
  })
  password: string

  @IsEnum(UserRole)
  role: UserRole

  @IsDateString()
  dob: string

  @IsString()
  @IsIn(APP2_STATE_CODES, {
    message:
      'TRACT App 2 currently operates in TX, NJ, ' +
      'NY, MD, DE, FL, and PA only.',
  })
  stateCode: string
}
