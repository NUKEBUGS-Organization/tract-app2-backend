import { IsOptional, IsNumber, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class QueryMessagesDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number
}
