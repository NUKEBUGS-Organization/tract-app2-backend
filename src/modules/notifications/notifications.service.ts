import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model, Types } from 'mongoose'
import { AppGateway } from '../gateway/app.gateway'
import { NOTIFICATION_COUNT, NOTIFICATION_NEW } from '../gateway/socket-events.constants'
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
    private readonly gateway: AppGateway,
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

    const publicNotification = this.toPublic(notification)

    this.gateway.pushToUser(
      notification.userId.toString(),
      NOTIFICATION_NEW,
      publicNotification,
    )

    const unreadCount = await this.notificationModel.countDocuments({
      userId: notification.userId,
      isRead: false,
    })

    this.gateway.pushToUser(
      notification.userId.toString(),
      NOTIFICATION_COUNT,
      { unreadCount },
    )

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

    await this.emitUnreadCount(userId)
    return this.toPublic(notification)
  }

  async markAllRead(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      return { updated: 0, unreadCount: 0 }
    }

    const result = await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    )

    await this.emitUnreadCount(userId)
    return { updated: result.modifiedCount, unreadCount: 0 }
  }

  async removeOne(userId: string, notificationId: string) {
    if (!Types.ObjectId.isValid(notificationId)) {
      throw new NotFoundException('Notification not found.')
    }

    const notification = await this.notificationModel.findById(notificationId)
    if (!notification) {
      throw new NotFoundException('Notification not found.')
    }

    if (notification.userId.toString() !== userId) {
      throw new ForbiddenException('You can only delete your own notifications.')
    }

    await notification.deleteOne()
    await this.emitUnreadCount(userId)
    return { deleted: true, id: notificationId }
  }

  async clearAll(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      return { deleted: 0, unreadCount: 0 }
    }

    const result = await this.notificationModel.deleteMany({
      userId: new Types.ObjectId(userId),
    })

    await this.emitUnreadCount(userId)
    return { deleted: result.deletedCount, unreadCount: 0 }
  }

  private async emitUnreadCount(userId: string) {
    const unreadCount = await this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    })
    this.gateway.pushToUser(userId, NOTIFICATION_COUNT, { unreadCount })
    return unreadCount
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
