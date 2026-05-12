import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { Message, MessageDocument } from './schemas/message.schema'
import { Deal, DealDocument } from '../deals/schemas/deal.schema'
import { SendMessageDto } from './dto/send-message.dto'
import { QueryMessagesDto } from './dto/query-messages.dto'
import { filterMessage } from './anti-circumvention.filter'
import { UserRole } from '../../common/enums/user-role.enum'
import { DealStep } from '../../common/enums/deal-step.enum'
import { ScoringService } from '../penalties/scoring.service'
import { ViolationType } from '../penalties/schemas/penalty.schema'
import { AppGateway } from '../gateway/app.gateway'
import { SOCKET_EVENTS } from '../gateway/socket-events.constants'

/** Reserved ObjectId for system/audit messages (no real User document). */
const SYSTEM_MESSAGE_SENDER_OBJECT_ID = '000000000000000000000001'

const VIOLATION_THRESHOLD = 3 // strikes before penalty

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocument>,
    private readonly scoringService: ScoringService,
    private readonly gateway: AppGateway,
  ) {}

  // ── Send a message ────────────────────────────────────────────
  async sendMessage(senderId: string, dto: SendMessageDto): Promise<MessageDocument> {
    const deal = await this.dealModel.findById(dto.dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    const isParty =
      deal.primaryBuyerId.toString() === senderId ||
      deal.wholesalerId.toString() === senderId ||
      deal.titleRepId?.toString() === senderId

    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    const chatUnlocked = deal.currentStep !== DealStep.CONTRACT_SIGNED

    if (!chatUnlocked) {
      throw new ForbiddenException('Chat is locked until both parties sign the contract.')
    }

    if (deal.disputeFrozen) {
      throw new ForbiddenException('Chat is frozen due to an active dispute.')
    }

    const filterResult = filterMessage(dto.content)

    const message = await this.messageModel.create({
      dealId: new Types.ObjectId(dto.dealId),
      senderId: new Types.ObjectId(senderId),
      content: filterResult.isBlocked ? filterResult.sanitized : dto.content,
      isFlagged: filterResult.isBlocked,
      flagType: filterResult.flagType,
      isBlocked: filterResult.isBlocked,
      blockedReason: filterResult.blockedReason,
    })

    if (filterResult.isBlocked) {
      this.logger.warn(
        `Anti-circumvention: ${filterResult.flagType} ` +
          `detected from ${senderId} on deal ${dto.dealId}`,
      )

      await this.checkAndApplyCircumventionPenalty(senderId, dto.dealId)
    }

    if (!filterResult.isBlocked) {
      const doc = message as MessageDocument & { createdAt?: Date }
      const createdAt = doc.createdAt ?? new Date()
      this.gateway.emitToDeal(dto.dealId, SOCKET_EVENTS.CHAT_MESSAGE, {
        dealId: dto.dealId,
        messageId: message._id.toString(),
        senderId,
        content: message.content,
        createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
      })
    }

    return message
  }

  // ── Get messages for a deal ───────────────────────────────────
  async getMessages(
    dealId: string,
    userId: string,
    role: string,
    query: QueryMessagesDto,
  ): Promise<{
    messages: MessageDocument[]
    total: number
    page: number
  }> {
    const deal = await this.dealModel.findById(dealId)
    if (!deal) throw new NotFoundException('Deal not found.')

    const isParty =
      role === UserRole.ADMIN ||
      deal.primaryBuyerId.toString() === userId ||
      deal.wholesalerId.toString() === userId ||
      deal.titleRepId?.toString() === userId

    if (!isParty) {
      throw new ForbiddenException('You are not a party to this deal.')
    }

    if (role !== UserRole.ADMIN && deal.currentStep === DealStep.CONTRACT_SIGNED) {
      throw new ForbiddenException('Chat is locked until both parties sign the contract.')
    }

    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const filter: Record<string, unknown> = {
      dealId: new Types.ObjectId(dealId),
    }
    if (role !== UserRole.ADMIN) {
      filter.isBlocked = false
    }

    const [messages, total] = await Promise.all([
      this.messageModel
        .find(filter)
        .populate('senderId', 'fullName role')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.messageModel.countDocuments(filter),
    ])

    if (role !== UserRole.ADMIN) {
      await this.messageModel.updateMany(
        {
          dealId: new Types.ObjectId(dealId),
          senderId: { $ne: new Types.ObjectId(userId) },
          readAt: null,
          isBlocked: false,
        },
        { $set: { readAt: new Date() } },
      )
    }

    return {
      messages: messages as MessageDocument[],
      total,
      page,
    }
  }

  // ── Get flagged messages (admin surveillance) ─────────────────
  async getFlaggedMessages(query: QueryMessagesDto): Promise<{
    messages: MessageDocument[]
    total: number
  }> {
    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const skip = (page - 1) * limit

    const [messages, total] = await Promise.all([
      this.messageModel
        .find({ isFlagged: true })
        .populate('senderId', 'fullName email role')
        .populate('dealId', 'listingId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      this.messageModel.countDocuments({ isFlagged: true }),
    ])

    return { messages: messages as MessageDocument[], total }
  }

  // ── Check repeat violations and apply penalty ─────────────────
  private async checkAndApplyCircumventionPenalty(senderId: string, dealId: string): Promise<void> {
    const recentViolations = await this.messageModel.countDocuments({
      senderId: new Types.ObjectId(senderId),
      isFlagged: true,
    })

    if (recentViolations === VIOLATION_THRESHOLD) {
      await this.scoringService.applyViolation(senderId, ViolationType.GHOSTING, { dealId })
      this.logger.warn(
        `Anti-circumvention penalty applied to ${senderId} ` +
          `after ${recentViolations} violations`,
      )
    }
  }

  // ── Send system message (deal events) ────────────────────────
  async sendSystemMessage(dealId: string, content: string): Promise<MessageDocument> {
    return this.messageModel.create({
      dealId: new Types.ObjectId(dealId),
      senderId: new Types.ObjectId(SYSTEM_MESSAGE_SENDER_OBJECT_ID),
      content,
      isSystemMessage: true,
      isFlagged: false,
      isBlocked: false,
      flagType: null,
      blockedReason: null,
      readAt: null,
    })
  }
}
