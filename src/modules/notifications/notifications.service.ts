import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import {
  Notification,
  NotificationChannel,
  NotificationDocument,
  NotificationType,
} from './schemas/notification.schema'

export interface CreateNotificationInput {
  userId: string
  title: string
  body: string
  type: NotificationType
  channel: NotificationChannel
  dealId?: string | null
  listingId?: string | null
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async create(input: CreateNotificationInput): Promise<NotificationDocument> {
    if (!Types.ObjectId.isValid(input.userId)) {
      throw new NotFoundException('User not found.')
    }

    const dealId =
      input.dealId && Types.ObjectId.isValid(input.dealId)
        ? new Types.ObjectId(input.dealId)
        : null
    const listingId =
      input.listingId && Types.ObjectId.isValid(input.listingId)
        ? new Types.ObjectId(input.listingId)
        : null

    const notification = await this.notificationModel.create({
      userId: new Types.ObjectId(input.userId),
      ...(dealId ? { dealId } : {}),
      ...(listingId ? { listingId } : {}),
      channel: input.channel,
      title: input.title,
      body: input.body,
      type: input.type,
      isRead: false,
      readAt: null,
    })

    return notification
  }

  async listByUser(userId: string, limit = 50): Promise<ReturnType<NotificationsService['toPublic']>[]> {
    if (!Types.ObjectId.isValid(userId)) {
      return []
    }

    const notifications = await this.notificationModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 100))
      .exec()

    return notifications.map((n) => this.toPublic(n))
  }

  async markRead(userId: string, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new NotFoundException('Notification not found.')
    }

    const notification = await this.notificationModel.findById(notificationId)
    if (!notification) {
      throw new NotFoundException('Notification not found.')
    }

    if (notification.userId.toString() !== userId) {
      throw new ForbiddenException('You can only mark your own notifications as read.')
    }

    if (!notification.isRead) {
      notification.isRead = true
      notification.readAt = new Date()
      await notification.save()
    }

    return this.toPublic(notification)
  }

  toPublic(notification: NotificationDocument) {
    const n = notification.toObject()
    return {
      id: notification._id.toString(),
      userId: notification.userId.toString(),
      dealId: notification.dealId?.toString() ?? null,
      listingId: notification.listingId?.toString() ?? null,
      channel: notification.channel,
      title: notification.title,
      body: notification.body,
      type: notification.type,
      isRead: notification.isRead,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt:
        n.createdAt instanceof Date ? n.createdAt.toISOString() : new Date().toISOString(),
      updatedAt:
        n.updatedAt instanceof Date ? n.updatedAt.toISOString() : new Date().toISOString(),
    }
  }
}
