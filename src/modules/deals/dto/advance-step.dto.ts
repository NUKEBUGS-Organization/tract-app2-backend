import { IsEnum } from 'class-validator'
import { DealStep } from '../../../common/enums/deal-step.enum'

export class AdvanceStepDto {
  @IsEnum(DealStep)
  step: DealStep
}
