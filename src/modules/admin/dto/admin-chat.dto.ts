export class FlaggedMessageDto {
  id!: string
  dealId!: string
  senderId!: string
  senderName!: string
  senderRole!: string
  content!: string
  flagType!: string
  flagLabel!: string
  createdAt!: string
  isBlocked!: boolean
}
