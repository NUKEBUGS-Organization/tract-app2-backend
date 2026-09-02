import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { User, UserDocument } from '../../users/schemas/user.schema'
import { Session, SessionDocument } from '../../sessions/schemas/session.schema'
import { APP2_ALLOWED_ROLES, UserRole } from '../../../common/enums/user-role.enum'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Session.name) private sessionModel: Model<SessionDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    })
  }

  async validate(payload: {
    sub: string
    email?: string
    role: string
    sessionId?: string
  }) {
    if (!payload.sessionId) {
      throw new UnauthorizedException('Invalid session token.')
    }

    const session = await this.sessionModel.findOne({
      sessionId: payload.sessionId,
      isBlacklisted: false,
    })
    if (!session) {
      throw new UnauthorizedException(
        'Session expired. You may have logged in from another device.',
      )
    }

    const user = await this.userModel.findById(payload.sub).lean()
    if (!user || user.isBanned) throw new UnauthorizedException()
    if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
      throw new UnauthorizedException()
    }
    return { ...user, sessionId: payload.sessionId }
  }
}
