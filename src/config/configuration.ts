export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  mongoUri: process.env.MONGODB_URI ?? '',

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  cors: {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
    authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? '',
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID ?? '',
  },

  mail: {
    host: process.env.MAIL_HOST ?? 'smtp.gmail.com',
    port: parseInt(process.env.MAIL_PORT ?? '587', 10),
    secure: process.env.MAIL_SECURE === 'true',
    user: process.env.MAIL_USER ?? '',
    pass: process.env.MAIL_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'TRACT <noreply@tract.com>',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  testing: {
    bypassOtp: process.env.TEST_BYPASS_OTP === 'true',
    testOtpCode: process.env.TEST_OTP_CODE ?? '123456',
    testPhones: (process.env.TEST_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    testEmails: (process.env.TEST_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  },
})
