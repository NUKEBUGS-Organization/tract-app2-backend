import { IsString, Matches, MinLength } from 'class-validator'

export class ChangePasswordDto {
  @IsString()
  currentPassword: string

  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[A-Z])(?=.*[0-9])/, {
    message: 'Password must contain at least 1 uppercase letter and 1 number.',
  })
  newPassword: string
}
