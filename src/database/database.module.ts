import { Module }          from '@nestjs/common'
import { MongooseModule }  from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongoUri') ?? '',
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
