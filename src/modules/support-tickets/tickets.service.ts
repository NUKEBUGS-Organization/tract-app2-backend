import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { UserRole } from '../../common/enums/user-role.enum'
import { User, UserDocument } from '../users/schemas/user.schema'
import {
  NotificationsService,
} from '../notifications/notifications.service'
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/schemas/notification.schema'
import { CreateTicketDto } from './dto/create-ticket.dto'
import { UpdateTicketDto } from './dto/update-ticket.dto'
import {
  SupportTicket,
  SupportTicketDocument,
  TicketPriority,
  TicketStatus,
} from './schemas/support-ticket.schema'

type AuthUser = {
  _id: { toString(): string }
  role: UserRole
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(SupportTicket.name)
    private readonly ticketModel: Model<SupportTicketDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(user: AuthUser, dto: CreateTicketDto) {
    const userId = user._id.toString()
    const ticket = await this.ticketModel.create({
      userId: new Types.ObjectId(userId),
      userRole: user.role,
      subject: dto.subject.trim(),
      description: dto.description.trim(),
      status: TicketStatus.OPEN,
      priority: dto.priority ?? TicketPriority.MEDIUM,
      assignedTo: null,
      messages: [
        {
          senderId: new Types.ObjectId(userId),
          senderRole: user.role,
          body: dto.description.trim(),
          createdAt: new Date(),
        },
      ],
    })

    await this.notificationsService.create({
      userId,
      channel: NotificationChannel.IN_APP,
      type: NotificationType.TICKET_CREATED,
      title: 'Support ticket submitted',
      body: `We received your request: "${ticket.subject}". Our team will respond shortly.`,
    })

    await this.notifyAdmins(
      NotificationType.TICKET_CREATED,
      'New support ticket',
      `${user.role} submitted: "${ticket.subject}"`,
    )

    return this.toPublic(ticket)
  }

  async listForUser(user: AuthUser) {
    const filter =
      user.role === UserRole.ADMIN
        ? {}
        : { userId: new Types.ObjectId(user._id.toString()) }

    const tickets = await this.ticketModel
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(100)
      .exec()

    return tickets.map((t) => this.toPublic(t))
  }

  async findOne(user: AuthUser, ticketId: string) {
    const ticket = await this.getTicketOrThrow(ticketId)
    this.assertCanAccess(user, ticket)
    return this.toPublic(ticket)
  }

  async update(user: AuthUser, ticketId: string, dto: UpdateTicketDto) {
    const ticket = await this.getTicketOrThrow(ticketId)
    this.assertCanAccess(user, ticket)

    const isAdmin = user.role === UserRole.ADMIN
    const isOwner = ticket.userId.toString() === user._id.toString()

    if (dto.assignedTo !== undefined && !isAdmin) {
      throw new ForbiddenException('Only admins can assign tickets.')
    }

    if (dto.status !== undefined && !isAdmin) {
      throw new ForbiddenException('Only admins can change ticket status.')
    }

    if (dto.reply) {
      if (!isAdmin && !isOwner) {
        throw new ForbiddenException('You cannot reply on this ticket.')
      }
      ticket.messages.push({
        senderId: new Types.ObjectId(user._id.toString()),
        senderRole: user.role,
        body: dto.reply.trim(),
        createdAt: new Date(),
      })

      if (isAdmin) {
        await this.notificationsService.create({
          userId: ticket.userId.toString(),
          channel: NotificationChannel.IN_APP,
          type: NotificationType.TICKET_REPLY,
          title: 'Support team replied',
          body: `New reply on "${ticket.subject}".`,
        })
      } else {
        const assigneeId = ticket.assignedTo?.toString()
        if (assigneeId) {
          await this.notificationsService.create({
            userId: assigneeId,
            channel: NotificationChannel.IN_APP,
            type: NotificationType.TICKET_REPLY,
            title: 'Ticket reply from user',
            body: `User replied on "${ticket.subject}".`,
          })
        } else {
          await this.notifyAdmins(
            NotificationType.TICKET_REPLY,
            'User replied to ticket',
            `Reply on "${ticket.subject}".`,
          )
        }
      }
    }

    if (dto.assignedTo !== undefined) {
      ticket.assignedTo = new Types.ObjectId(dto.assignedTo)
      if (ticket.status === TicketStatus.OPEN) {
        ticket.status = TicketStatus.IN_PROGRESS
      }
    }

    const previousStatus = ticket.status
    if (dto.status !== undefined) {
      ticket.status = dto.status
    }

    await ticket.save()

    if (
      dto.status === TicketStatus.RESOLVED &&
      previousStatus !== TicketStatus.RESOLVED
    ) {
      await this.notificationsService.create({
        userId: ticket.userId.toString(),
        channel: NotificationChannel.IN_APP,
        type: NotificationType.TICKET_RESOLVED,
        title: 'Support ticket resolved',
        body: `Your ticket "${ticket.subject}" has been marked resolved.`,
      })
    }

    return this.toPublic(ticket)
  }

  async claim(user: AuthUser, ticketId: string) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Only admins can claim tickets.')
    }

    const ticket = await this.getTicketOrThrow(ticketId)
    ticket.assignedTo = new Types.ObjectId(user._id.toString())
    if (ticket.status === TicketStatus.OPEN) {
      ticket.status = TicketStatus.IN_PROGRESS
    }
    await ticket.save()
    return this.toPublic(ticket)
  }

  private async getTicketOrThrow(ticketId: string) {
    if (!Types.ObjectId.isValid(ticketId)) {
      throw new NotFoundException('Ticket not found.')
    }
    const ticket = await this.ticketModel.findById(ticketId)
    if (!ticket) throw new NotFoundException('Ticket not found.')
    return ticket
  }

  private assertCanAccess(user: AuthUser, ticket: SupportTicketDocument) {
    if (user.role === UserRole.ADMIN) return
    if (ticket.userId.toString() !== user._id.toString()) {
      throw new ForbiddenException('You do not have access to this ticket.')
    }
  }

  private async notifyAdmins(
    type: NotificationType,
    title: string,
    body: string,
  ) {
    const admins = await this.userModel
      .find({ role: UserRole.ADMIN })
      .select('_id')
      .lean()
      .exec()

    await Promise.all(
      admins.map((admin) =>
        this.notificationsService.create({
          userId: admin._id.toString(),
          channel: NotificationChannel.IN_APP,
          type,
          title,
          body,
        }),
      ),
    )
  }

  toPublic(ticket: SupportTicketDocument) {
    const doc = ticket.toObject()
    return {
      id: ticket._id.toString(),
      userId: ticket.userId.toString(),
      userRole: ticket.userRole,
      subject: ticket.subject,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      assignedTo: ticket.assignedTo?.toString() ?? null,
      messages: ticket.messages.map((m) => ({
        senderId: m.senderId.toString(),
        senderRole: m.senderRole,
        body: m.body,
        createdAt:
          m.createdAt instanceof Date
            ? m.createdAt.toISOString()
            : new Date().toISOString(),
      })),
      createdAt:
        doc.createdAt instanceof Date
          ? doc.createdAt.toISOString()
          : new Date().toISOString(),
      updatedAt:
        doc.updatedAt instanceof Date
          ? doc.updatedAt.toISOString()
          : new Date().toISOString(),
    }
  }
}
