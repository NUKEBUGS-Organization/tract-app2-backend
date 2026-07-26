import { Module }          from '@nestjs/common'
import { MongooseModule }  from '@nestjs/mongoose'
import { ConfigModule, ConfigService } from '@nestjs/config'

@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: "mongodb+srv://tract:Tract123@cluster0.ly7hqwa.mongodb.net/tract?appName=Cluster0",
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
  ],
})
export class DatabaseModule {}
// uri: config.get<string>('mongoUri') ?? '',
