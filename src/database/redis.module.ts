import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import Redis from 'ioredis'

export const REDIS_CLIENT = 'REDIS_CLIENT'

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redis.url') ?? 'redis://localhost:6379'
        const client = new Redis(url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        })
        client.on('error', (err) => console.error('[Redis] connection error:', err))
        return client
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
