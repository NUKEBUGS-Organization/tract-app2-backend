import { IsIn } from 'class-validator'

export class TitleHandlingDto {
  @IsIn(['own_rep', 'tract'])
  titleHandling: 'own_rep' | 'tract'
}
