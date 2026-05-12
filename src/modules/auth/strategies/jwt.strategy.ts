import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { ConfigService }        from '@nestjs/config'
import { InjectModel }          from '@nestjs/mongoose'
import { Model }                from 'mongoose'
import { User, UserDocument }   from '../../users/schemas/user.schema'

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {
    super({
      jwtFromRequest:   ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:      config.get<string>('jwt.accessSecret') ?? 'dev_access_secret_not_for_production',
    })
  }

  async validate(payload: { sub: string; email?: string; role: string }) {
    const user = await this.userModel.findById(payload.sub).lean()
    if (!user || user.isBanned) throw new UnauthorizedException()
    return user
  }
}
