import { IsString, IsMongoId, MinLength, MaxLength } from 'class-validator'

export class SendMessageDto {
  @IsMongoId()
  dealId: string

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string
}
