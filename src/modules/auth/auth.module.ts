import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import type { SignOptions } from 'jsonwebtoken'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MongooseModule } from '@nestjs/mongoose'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { OtpService } from './otp.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { User, UserSchema } from '../users/schemas/user.schema'
import { NotificationsModule } from '../notifications/notifications.module'

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret') ?? 'secret',
        signOptions: {
          expiresIn: config.get<string>('jwt.accessExpiresIn') ?? '15m',
        } as SignOptions,
      }),
    }),
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    NotificationsModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
