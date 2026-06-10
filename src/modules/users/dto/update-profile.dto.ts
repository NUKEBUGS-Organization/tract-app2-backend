import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { APP2_STATE_CODES } from '../../../common/constants/states.constants'

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string

  @IsOptional()
  @IsIn(APP2_STATE_CODES, {
    message: 'State must be one of the 7 supported states.',
  })
  stateCode?: string
}
