import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsEnum, IsMongoId, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { TicketStatus } from '../schemas/support-ticket.schema'

export class UpdateTicketDto {
  @ApiPropertyOptional({ enum: TicketStatus })
  @IsOptional()
  @IsEnum(TicketStatus)
  status?: TicketStatus

  @ApiPropertyOptional({ description: 'Admin assignee user id' })
  @IsOptional()
  @IsMongoId()
  assignedTo?: string

  @ApiPropertyOptional({ description: 'Reply message body' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  reply?: string
}
