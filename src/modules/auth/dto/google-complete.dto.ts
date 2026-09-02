import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator'
import { UserRole } from '../../../common/enums/user-role.enum'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'
import { IsAdultDateString } from '../../../common/validators/is-adult-date-string.validator'

export class GoogleCompleteDto {
  @IsString()
  @IsNotEmpty()
  token: string

  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+?[1-9]\d{9,14}$/, {
    message: 'Enter a valid phone number (digits or E.164 with +)',
  })
  phone: string

  @IsIn(
    [UserRole.WHOLESALER, UserRole.REALTOR, UserRole.BUYER, UserRole.TITLE_REP],
    {
      message: 'Role must be one of: wholesaler, realtor, buyer, title_rep',
    },
  )
  role: string

  @IsAdultDateString()
  dob: string

  @IsString()
  @IsIn(APP2_STATE_CODES, {
    message: 'TRACT App 2 currently operates in TX, NJ, NY, MD, DE, FL, and PA only.',
  })
  stateCode: string
}
