import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { Session, SessionDocument } from './schemas/session.schema'

@Injectable()
export class SessionsService {
  constructor(
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {}

  async create(data: Partial<Session>): Promise<SessionDocument> {
    return this.sessionModel.create(data)
  }

  async findActiveBySessionId(sessionId: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ sessionId, isBlacklisted: false })
  }

  async blacklistAllForUser(userId: string): Promise<void> {
    await this.sessionModel.updateMany(
      { userId, isBlacklisted: false },
      { isBlacklisted: true },
    )
  }

  async blacklistSession(sessionId: string): Promise<void> {
    await this.sessionModel.updateOne({ sessionId }, { isBlacklisted: true })
  }
}
