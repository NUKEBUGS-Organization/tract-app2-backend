import { Module }           from '@nestjs/common'
import { ConfigModule }     from '@nestjs/config'
import { ThrottlerModule }  from '@nestjs/throttler'
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'

import configuration                from './config/configuration'
import { DatabaseModule }           from './database/database.module'
import { RedisModule }              from './database/redis.module'
import { HttpExceptionFilter }      from './common/filters/http-exception.filter'
import { TransformInterceptor }     from './common/interceptors/transform.interceptor'
import { JwtAuthGuard }             from './common/guards/jwt-auth.guard'
import { RolesGuard }               from './common/guards/roles.guard'

import { AuthModule }          from './modules/auth/auth.module'
import { UsersModule }         from './modules/users/users.module'
import { ListingsModule }      from './modules/listings/listings.module'
import { BidsModule }          from './modules/bids/bids.module'
import { ContractsModule }     from './modules/contracts/contracts.module'
import { DealsModule }         from './modules/deals/deals.module'
import { ChatModule }          from './modules/chat/chat.module'
import { PaymentsModule }      from './modules/payments/payments.module'
import { NotificationsModule } from './modules/notifications/notifications.module'
import { PenaltiesModule }     from './modules/penalties/penalties.module'
import { RatingsModule }       from './modules/ratings/ratings.module'
import { AdminModule }         from './modules/admin/admin.module'
import { GatewayModule } from './modules/gateway/gateway.module'

@Module({
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
    PenaltiesModule,
    RatingsModule,
    AdminModule,
    GatewayModule,
  ],
  providers: [
    { provide: APP_FILTER,      useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD,       useClass: JwtAuthGuard },
    { provide: APP_GUARD,       useClass: RolesGuard },
  ],
})
export class AppModule {}
