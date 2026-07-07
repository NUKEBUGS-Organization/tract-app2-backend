import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { TicketPriority } from '../schemas/support-ticket.schema'

export class CreateTicketDto {
  @ApiProperty({ example: 'Cannot access my deal tracker' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject: string

  @ApiProperty({ example: 'After signing the contract, the deal page shows a blank screen.' })
  @IsString()
  @MinLength(10)
  @MaxLength(10000)
  description: string

  @ApiPropertyOptional({ enum: TicketPriority, default: TicketPriority.MEDIUM })
  @IsOptional()
  @IsEnum(TicketPriority)
  priority?: TicketPriority
}
