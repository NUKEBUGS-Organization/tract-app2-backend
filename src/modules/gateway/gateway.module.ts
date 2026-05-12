import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { AppGateway } from './app.gateway'

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('jwt.accessSecret') ?? 'secret',
      }),
    }),
  ],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
