import { NestFactory }         from '@nestjs/core'
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
  const port   = config.get<number>('port') ?? 3001
  const origin = config.get<string>('cors.origin') ?? 'http://localhost:5173'
  const prefix = config.get<string>('apiPrefix') ?? 'api/v1'

  app.use(helmet())
  app.use(cookieParser())

  app.enableCors({
    origin,
    credentials:      true,
    allowedHeaders:   ['Content-Type', 'Authorization'],
    methods:          ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],
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
