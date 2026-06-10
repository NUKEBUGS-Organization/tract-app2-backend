import './preload-env'

import { NestFactory } from '@nestjs/core'
import { Logger, ValidationPipe, RequestMethod } from '@nestjs/common'
import { ConfigService }       from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet                  from 'helmet'
import cookieParser            from 'cookie-parser'
import { AppModule } from './app.module'
import { GlobalExceptionFilter } from './common/filters/http-exception.filter'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  })

  const config = app.get(ConfigService)
  const port = config.get<number>('port') ?? 3001
  const prefix = config.get<string>('apiPrefix') ?? 'api/v1'
  const allowedRaw = config.get<string[]>('cors.origins') ?? ['http://localhost:5173']
  const allowedOrigins = new Set(
    allowedRaw.map((o) => o.trim().replace(/\/$/, '')).filter(Boolean),
  )

  app.use(helmet())
  app.use(cookieParser())

  app.enableCors({
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: (
      reqOrigin: string | undefined,
      callback: (err: Error | null, allow?: boolean | string | RegExp) => void,
    ) => {
      if (!reqOrigin) {
        callback(null, true)
        return
      }
      const normalized = reqOrigin.trim().replace(/\/$/, '')
      if (allowedOrigins.has(normalized)) {
        callback(null, reqOrigin.trim())
        return
      }
      callback(null, false)
    },
  })

  app.setGlobalPrefix(prefix, {
    exclude: [
      { path: 'api/docs/(.*)', method: RequestMethod.ALL },
      { path: '/', method: RequestMethod.GET },
      { path: '/', method: RequestMethod.HEAD },
    ],
  })

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  app.useGlobalFilters(new GlobalExceptionFilter())
  new Logger('Bootstrap').log('GlobalExceptionFilter registered')

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TRACT App 2 API')
    .setDescription(
      'Private Real Estate Marketplace — Marketplace Engine API. ' +
      'All endpoints require JWT Bearer token except auth routes.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type:         'http',
        scheme:       'bearer',
        bearerFormat: 'JWT',
        name:         'Authorization',
        description:  'Enter your JWT access token',
        in:           'header',
      },
      'JWT-auth',
    )
    .addTag('auth',     'Authentication — login, register, OTP')
    .addTag('users',    'User profile and reliability score')
    .addTag('listings', 'Marketplace listings — create, publish, browse')
    .addTag('bids',     'Bidding engine — place bids, 1-2-Delete selection')
    .addTag('deals',    '8-step deal pipeline tracker')
    .addTag('chat',     'In-deal chat with anti-circumvention')
    .addTag('ratings',  'Post-close ratings and trust layer')
    .addTag('admin',    'Admin control center')
    .addTag('wholesaler', 'Wholesaler dashboard and tools')
    .addTag('buyer', 'Buyer dashboard and activity')
    .addTag('title', 'Title representative dashboard')
    .addTag('pdf', 'PDF document generation')
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)

  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter:           'alpha',
      operationsSorter:     'alpha',
    },
    customSiteTitle: 'TRACT API Docs',
  })

  console.log(
    `Swagger docs available at http://localhost:${port}/api/docs`,
  )

  const host = process.env.HOST ?? '0.0.0.0'
  await app.listen(port, host)
  console.log(`TRACT API running on ${host}:${port} — prefix: /${prefix}`)
}

bootstrap()
