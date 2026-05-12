import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import Redis from 'ioredis'
import { AppModule } from './../src/app.module'

const describeMongo = process.env.MONGODB_URI ? describe : describe.skip

describeMongo('TRACT API (e2e)', () => {
  let app: INestApplication<App>
  let redis: Redis

  jest.setTimeout(45_000)

  beforeEach(async () => {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379'
    redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true })
    await redis.connect().catch(() => undefined)

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.use(cookieParser())
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    )
    await app.init()
  })

  it('send-otp → verify-otp → register → users/me → login → refresh → logout', async () => {
    const stamp = Date.now()
    const email = `e2e_${stamp}@test.com`
    const phoneE164 = `+1${String(stamp).slice(-10).padStart(10, '0')}`
    const password = 'Password1'
    const registerBody = {
      fullName: 'E2E User',
      email,
      phone: phoneE164,
      password,
      role: 'buyer',
      dob: '1990-01-01',
      stateCode: 'CA',
    }

    const agent = request.agent(app.getHttpServer())

    await agent.post('/api/v1/auth/send-otp').send({ phone: phoneE164, email }).expect(200)

    const phoneKey = phoneE164.replace(/\D/g, '')
    const smsCode = await redis.get(`otp:sms:${phoneKey}`)
    const emailCode = await redis.get(`otp:email:${email.toLowerCase()}`)
    expect(smsCode).toHaveLength(6)
    expect(emailCode).toHaveLength(6)

    await agent
      .post('/api/v1/auth/verify-otp')
      .send({
        phone: phoneE164,
        email,
        smsOtp: smsCode,
        emailOtp: emailCode,
      })
      .expect(200)

    const reg = await agent.post('/api/v1/auth/register').send(registerBody).expect(201)
    expect(reg.body.success).toBe(true)
    expect(reg.body.data.accessToken).toBeTruthy()
    expect(reg.body.data.user.email).toBe(email.toLowerCase())

    const access = reg.body.data.accessToken as string

    const me = await agent.get('/api/v1/users/me').set('Authorization', `Bearer ${access}`).expect(200)
    expect(me.body.success).toBe(true)
    expect(me.body.data.email).toBe(email.toLowerCase())

    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200)
    expect(login.body.success).toBe(true)
    expect(login.body.data.accessToken).toBeTruthy()

    const refreshed = await agent.post('/api/v1/auth/refresh').expect(200)
    expect(refreshed.body.success).toBe(true)
    expect(refreshed.body.data.accessToken).toBeTruthy()

    await agent.post('/api/v1/auth/logout').set('Authorization', `Bearer ${login.body.data.accessToken}`).expect(200)
    await agent.post('/api/v1/auth/refresh').expect(401)
  })

  afterEach(async () => {
    await app.close()
    await redis.quit().catch(() => undefined)
  })
})
