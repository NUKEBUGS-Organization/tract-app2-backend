import { IsMongoId } from 'class-validator'

export class AssignTitleRepDto {
  @IsMongoId({ message: 'Select a valid title representative.' })
  titleRepId: string
}
