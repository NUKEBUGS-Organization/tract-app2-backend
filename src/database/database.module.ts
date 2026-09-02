import { Module }          from '@nestjs/common'
import { MongooseModule }  from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongoUri') ?? process.env.MONGODB_URI ?? '',
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
// uri: config.get<string>('mongoUri') ?? '',
