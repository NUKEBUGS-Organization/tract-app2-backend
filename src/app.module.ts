import { Module } from '@nestjs/common'
import { AppController }    from './app.controller'
import { ConfigModule }     from '@nestjs/config'
import { ThrottlerModule }  from '@nestjs/throttler'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import configuration                from './config/configuration'
import { DatabaseModule }           from './database/database.module'
import { RedisModule }              from './database/redis.module'
import { TransformInterceptor } from './common/interceptors/transform.interceptor'
import { JwtAuthGuard }             from './common/guards/jwt-auth.guard'
import { RolesGuard }               from './common/guards/roles.guard'
import { KycApprovedGuard }       from './common/guards/kyc-approved.guard'

import { AuthModule }          from './modules/auth/auth.module'
import { UsersModule }         from './modules/users/users.module'
import { ListingsModule }      from './modules/listings/listings.module'
import { BidsModule }          from './modules/bids/bids.module'
import { ContractsModule }     from './modules/contracts/contracts.module'
import { DealsModule }         from './modules/deals/deals.module'
import { ChatModule }          from './modules/chat/chat.module'
import { PaymentsModule }      from './modules/payments/payments.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { TicketsModule } from './modules/support-tickets/tickets.module'
import { FaqModule } from './modules/faq/faq.module'
import { PenaltiesModule }     from './modules/penalties/penalties.module'
import { RatingsModule }       from './modules/ratings/ratings.module'
import { AdminModule }         from './modules/admin/admin.module'
import { GatewayModule } from './modules/gateway/gateway.module'
import { WholesalerModule } from './modules/wholesaler/wholesaler.module'
import { BuyerModule } from './modules/buyer/buyer.module'
import { TitleModule } from './modules/title/title.module'
import { PdfModule } from './modules/pdf/pdf.module'
import { VaultModule } from './modules/vault/vault.module'

@Module({
  controllers: [AppController],
  imports: [
    ConfigModule.forRoot({
      isGlobal:    true,
      load:        [configuration],
      envFilePath: '.env',
    }),
    ThrottlerModule.forRoot([{
      ttl:   60000,
      limit: 100,
    }]),
    DatabaseModule,
    RedisModule,
    AuthModule,
    UsersModule,
    ListingsModule,
    BidsModule,
    ContractsModule,
    DealsModule,
    ChatModule,
    PaymentsModule,
    NotificationsModule,
    TicketsModule,
    FaqModule,
    PenaltiesModule,
    RatingsModule,
    AdminModule,
    GatewayModule,
    WholesalerModule,
    BuyerModule,
    TitleModule,
    PdfModule,
    VaultModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
    { provide: APP_GUARD,       useClass: KycApprovedGuard },
  ],
})
export class AppModule {}
