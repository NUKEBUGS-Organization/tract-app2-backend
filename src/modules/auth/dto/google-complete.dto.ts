import { IsDateString, IsIn, IsString, Matches } from 'class-validator'
import { UserRole } from '../../../common/enums/user-role.enum'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

export class GoogleCompleteDto {
  @IsString()
  token: string

  @IsString()
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

  @IsDateString()
  dob: string

  @IsString()
  @IsIn(APP2_STATE_CODES, {
    message: 'TRACT App 2 currently operates in TX, NJ, NY, MD, DE, FL, and PA only.',
  })
  stateCode: string
}
