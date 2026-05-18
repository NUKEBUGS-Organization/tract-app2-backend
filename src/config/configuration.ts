export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  mongoUri: process.env.MONGODB_URI ?? '',

  jwt: {
    accessSecret: (() => {
      const v = process.env.JWT_ACCESS_SECRET
      if (!v && process.env.NODE_ENV === 'production') {
        throw new Error('JWT_ACCESS_SECRET is required in production')
      }
      return v ?? 'dev_access_secret_not_for_production'
    })(),
    refreshSecret: (() => {
      const v = process.env.JWT_REFRESH_SECRET
      if (!v && process.env.NODE_ENV === 'production') {
        throw new Error('JWT_REFRESH_SECRET is required in production')
      }
      return v ?? 'dev_refresh_secret_not_for_production'
    })(),
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  cors: {
    /** Comma-separated allowlist; each value normalized (trim, no trailing slash). */
    origins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
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

  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.RESEND_FROM_EMAIL ?? 'TRACT <onboarding@resend.dev>',
  },

  redis: {
    url: (() => {
      const raw = process.env.REDIS_URL?.trim()
      const fallback = 'redis://localhost:6379'
      if (process.env.NODE_ENV === 'production') {
        if (!raw) {
          throw new Error(
            'REDIS_URL is required in production. Add a cloud Redis URL on Render (e.g. Upstash) — there is no localhost Redis on web services.',
          )
        }
        let hostname = ''
        try {
          hostname = new URL(raw).hostname.toLowerCase()
        } catch {
          throw new Error('REDIS_URL must be a valid URL (e.g. rediss://default:...@....upstash.io:6379)')
        }
        const loopback =
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname === '[::1]' ||
          hostname === '0.0.0.0'
        if (loopback) {
          throw new Error(
            'REDIS_URL cannot use a loopback host in production. Use a hosted Redis URL (Upstash, Redis Cloud, Render Key Value, etc.).',
          )
        }
        return raw
      }
      return raw || fallback
    })(),
  },

  testing: {
    bypassOtp: process.env.TEST_BYPASS_OTP === 'true',
    testOtpCode: process.env.TEST_OTP_CODE ?? '123456',
    testPhones: (process.env.TEST_PHONES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    testEmails: (process.env.TEST_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  },

  /** SPA origin (no trailing slash). */
  frontendUrl: (() => {
    const raw =
      process.env.FRONTEND_URL?.trim() ||
      process.env.CORS_ORIGIN?.split(',')[0]?.trim() ||
      'http://localhost:5173'
    return raw.replace(/\/$/, '')
  })(),

  jumio: {
    apiKey: process.env.JUMIO_API_KEY ?? '',
    apiSecret: process.env.JUMIO_API_SECRET ?? '',
    /**
     * Passed to Jumio Account API as callbackUrl (same pattern as tract-app1-backend).
     * Prefer JUMIO_CALLBACK_URL (public HTTPS in deployed/ngrok environments).
     * Otherwise falls back to API_PUBLIC_URL (backend base URL, no path).
     */
    callbackUrl: (() => {
      const explicit = process.env.JUMIO_CALLBACK_URL?.trim()
      if (explicit) return explicit
      const apiPublic = process.env.API_PUBLIC_URL?.trim().replace(/\/$/, '')
      if (apiPublic) return apiPublic
      if (process.env.NODE_ENV === 'production') return ''
      const port = parseInt(process.env.PORT ?? '3001', 10)
      return `http://127.0.0.1:${port}`
    })(),
    workflowDefinitionKey: parseInt(process.env.JUMIO_WORKFLOW_KEY ?? '10547', 10),
  },
})
