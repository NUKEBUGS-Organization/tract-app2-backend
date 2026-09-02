import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { App } from 'supertest/types'
import cookieParser from 'cookie-parser'
import Redis from 'ioredis'
import { AppModule } from '../src/app.module'

const describeMongo = process.env.MONGODB_URI ? describe : describe.skip
const TEST_OTP = process.env.TEST_OTP_CODE ?? '123456'

function uniquePhone(stamp: number): string {
  return `+1${String(stamp).slice(-10).padStart(10, '0')}`
}

async function readEmailOtp(redis: Redis, emailKey: string): Promise<string> {
  const code = await redis.get(`otp:email:${emailKey}`)
  if (!code) {
    throw new Error(`OTP not found in Redis for key otp:email:${emailKey}`)
  }
  return code
}

async function registerUser(
  agent: request.SuperAgentTest,
  redis: Redis,
  role: 'buyer' | 'wholesaler',
  stamp: number,
) {
  const email = `e2e_${role}_${stamp}@test.com`
  const phone = uniquePhone(stamp + (role === 'buyer' ? 1 : 2))
  const password = 'Password1'
  const body = {
    fullName: `E2E ${role}`,
    email,
    phone,
    password,
    role,
    dob: '1990-01-01',
    stateCode: 'TX',
  }

  await agent.post('/api/v1/auth/send-otp').send({ email }).expect(200)
  const emailOtp = await readEmailOtp(redis, email.toLowerCase())

  await agent
    .post('/api/v1/auth/verify-otp')
    .send({ email, emailOtp })
    .expect(200)

  const reg = await agent.post('/api/v1/auth/register').send(body).expect(201)
  return {
    email,
    phone,
    password,
    accessToken: reg.body.data.accessToken as string,
    userId: reg.body.data.user._id as string,
  }
}

async function loginUser(
  agent: request.SuperAgentTest,
  redis: Redis,
  email: string,
  password: string,
  useBypass = false,
) {
  await agent.post('/api/v1/auth/login').send({ email, password }).expect(200)
  const normalized = email.toLowerCase().trim()
  const loginOtp = useBypass
    ? TEST_OTP
    : await readEmailOtp(redis, `login:${normalized}`)

  const verified = await agent
    .post('/api/v1/auth/verify-login-otp')
    .send({ email: normalized, otp: loginOtp })
    .expect(200)

  return verified.body.data.accessToken as string
}

async function loginAdmin(
  app: INestApplication<App>,
  redis: Redis,
): Promise<string> {
  const agent = request.agent(app.getHttpServer())
  return loginUser(agent, redis, 'wasifzahoor296@gmail.com', 'admin1234!', false)
}

describeMongo('TRACT full platform (e2e)', () => {
  let app: INestApplication<App>
  let redis: Redis
  const stamp = Date.now()

  jest.setTimeout(120_000)

  beforeAll(async () => {
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

  afterAll(async () => {
    await app.close()
    await redis.quit().catch(() => undefined)
  })

  it('registers buyer and wholesaler accounts', async () => {
    const buyerAgent = request.agent(app.getHttpServer())
    const wholesalerAgent = request.agent(app.getHttpServer())

    const buyer = await registerUser(buyerAgent, redis, 'buyer', stamp)
    const wholesaler = await registerUser(wholesalerAgent, redis, 'wholesaler', stamp + 10)

    expect(buyer.accessToken).toBeTruthy()
    expect(wholesaler.accessToken).toBeTruthy()

    const buyerMe = await buyerAgent
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(200)
    expect(buyerMe.body.data.role).toBe('buyer')

    const wholesalerMe = await wholesalerAgent
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .expect(200)
    expect(wholesalerMe.body.data.role).toBe('wholesaler')
  })

  it('wholesaler creates listing → admin approves → buyer bids → wholesaler selects bid', async () => {
    const buyer = await registerUser(request.agent(app.getHttpServer()), redis, 'buyer', stamp + 100)
    const wholesaler = await registerUser(
      request.agent(app.getHttpServer()),
      redis,
      'wholesaler',
      stamp + 200,
    )

    const listingRes = await request(app.getHttpServer())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .send({ dealType: 'fix_flip', marketStatus: 'off_market' })
      .expect(201)

    const listingId = listingRes.body.data._id as string
    expect(listingId).toBeTruthy()

    await request(app.getHttpServer())
      .patch(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .send({
        propertyAddress: '123 E2E Test St',
        city: 'Austin',
        stateCode: 'TX',
        zipCode: '78701',
        arv: 350000,
        rehabTotal: 50000,
        purchasePrice: 250000,
        assignmentFeeLow: 10000,
        assignmentFeeHigh: 15000,
        estimatedHoldingCosts: 5000,
      })
      .expect(200)

    await request(app.getHttpServer())
      .post(`/api/v1/listings/${listingId}/publish`)
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .expect(200)

    const pending = await request(app.getHttpServer())
      .get('/api/v1/listings/pending-review')
      .set('Authorization', `Bearer ${await loginAdmin(app, redis)}`)
      .expect(200)

    const found = (pending.body.data as Array<{ _id: string }>).find((l) => l._id === listingId)
    expect(found).toBeTruthy()

    await request(app.getHttpServer())
      .post(`/api/v1/admin/listings/${listingId}/review`)
      .set('Authorization', `Bearer ${await loginAdmin(app, redis)}`)
      .send({ action: 'approve' })
      .expect(200)

    const marketplace = await request(app.getHttpServer()).get('/api/v1/listings').expect(200)
    const live = (marketplace.body.data.listings as Array<{ _id: string }>).find(
      (l) => l._id === listingId,
    )
    expect(live).toBeTruthy()

    const bidRes = await request(app.getHttpServer())
      .post('/api/v1/bids')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .send({
        listingId,
        assignmentPrice: 14000,
        emdAmount: 1000,
        inspectionDays: 7,
      })
      .expect(201)

    const bidId = bidRes.body.data._id as string
    expect(bidId).toBeTruthy()

    const bidsForListing = await request(app.getHttpServer())
      .get(`/api/v1/bids/listing/${listingId}`)
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .expect(200)

    expect((bidsForListing.body.data as unknown[]).length).toBeGreaterThanOrEqual(1)

    const selectRes = await request(app.getHttpServer())
      .post(`/api/v1/bids/listing/${listingId}/select`)
      .set('Authorization', `Bearer ${wholesaler.accessToken}`)
      .send({ primaryBidId: bidId })
      .expect(200)

    expect(selectRes.body.success).toBe(true)
  })

  it('seeded admin can access admin dashboard and user list', async () => {
    const token = await loginAdmin(app, redis)
    const dash = await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(dash.body.success).toBe(true)

    const users = await request(app.getHttpServer())
      .get('/api/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(users.body.success).toBe(true)
  })

  it('seeded realtor (test email bypass) can login and access wholesaler dashboard', async () => {
    const agent = request.agent(app.getHttpServer())
    const token = await loginUser(agent, redis, 'qaiserwaheed00@gmail.com', 'Test1234!', true)

    const dash = await request(app.getHttpServer())
      .get('/api/v1/wholesaler/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
    expect(dash.body.success).toBe(true)
  })

  it('role guard blocks buyer from admin routes', async () => {
    const buyer = await registerUser(request.agent(app.getHttpServer()), redis, 'buyer', stamp + 300)
    await request(app.getHttpServer())
      .get('/api/v1/admin/dashboard')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(403)
  })
})
