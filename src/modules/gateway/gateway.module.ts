import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { MongooseModule } from '@nestjs/mongoose'
import { AppGateway } from './app.gateway'
import { Deal, DealSchema } from '../deals/schemas/deal.schema'
import { Listing, ListingSchema } from '../listings/schemas/listing.schema'
import { Session, SessionSchema } from '../sessions/schemas/session.schema'

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: Listing.name, schema: ListingSchema },
      { name: Session.name, schema: SessionSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('jwt.accessSecret'),
      }),
    }),
  ],
  providers: [AppGateway],
  exports: [AppGateway],
})
export class GatewayModule {}
