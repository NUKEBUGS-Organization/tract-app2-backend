import { NestFactory }         from '@nestjs/core'
import { ValidationPipe }      from '@nestjs/common'
import { ConfigService }       from '@nestjs/config'
import helmet                  from 'helmet'
import cookieParser            from 'cookie-parser'
import { AppModule }           from './app.module'

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
    methods:          ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  })

  app.setGlobalPrefix(prefix)

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:        true,
      forbidNonWhitelisted: true,
      transform:        true,
      transformOptions: { enableImplicitConversion: true },
    }),
  )

  await app.listen(port)
  console.log(`TRACT API running on http://localhost:${port}/${prefix}`)
}

bootstrap()
