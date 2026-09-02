import { Injectable, Inject, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../database/redis.module'

const OTP_TTL_SECONDS = 600
const OTP_MAX_ATTEMPTS = 5

/** Purpose prefixes used as Redis key namespaces (login:/reset:). */
const EMAIL_KEY_PREFIXES = ['login:', 'reset:'] as const

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name)
  private readonly bypassOtp: boolean
  private readonly testCode: string
  private readonly testPhones: string[]
  private readonly testEmails: string[]

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    const nodeEnv = this.config.get<string>('nodeEnv') ?? 'production'
    const isDev = nodeEnv === 'development'
    this.bypassOtp = isDev && (this.config.get<boolean>('testing.bypassOtp') ?? false)
    this.testCode = this.config.get<string>('testing.testOtpCode') ?? '123456'
    this.testPhones = this.config.get<string[]>('testing.testPhones') ?? []
    this.testEmails = this.config.get<string[]>('testing.testEmails') ?? []

    if (this.bypassOtp) {
      this.logger.warn(
        '⚠ OTP BYPASS ENABLED — development mode only. ' +
          `Test code: ${this.testCode}. ` +
          `Test phones: [${this.testPhones.join(', ')}]. ` +
          `Test emails: [${this.testEmails.join(', ')}]`,
      )
    }
  }

  generate(): string {
    return Math.floor(100000 + Math.random() * 900000).toString()
  }

  /** Strip login:/reset: namespace so bypass matches bare TEST_EMAILS. */
  private bareEmail(emailOrKey: string): string {
    let value = emailOrKey.toLowerCase().trim()
    for (const prefix of EMAIL_KEY_PREFIXES) {
      if (value.startsWith(prefix)) {
        value = value.slice(prefix.length)
        break
      }
    }
    return value
  }

  /** Public for AuthService (dev bypass SMS skip). */
  isTestPhone(phone: string): boolean {
    return this.bypassOtp && this.testPhones.includes(phone)
  }

  /** Public for AuthService (dev bypass email skip). Accepts bare email or login:/reset: keys. */
  isTestEmail(email: string): boolean {
    return this.bypassOtp && this.testEmails.includes(this.bareEmail(email))
  }

  /** When true, failed Resend delivery should not block flows — OTP remains in Redis for QA. */
  isDevOtpBypassEnabled(): boolean {
    return this.bypassOtp
  }

  private smsKey(phone: string) {
    return `otp:sms:${phone.replace(/\D/g, '')}`
  }

  private emailKey(email: string) {
    return `otp:email:${email}`
  }

  private attemptsKey(id: string) {
    return `otp:attempts:${id.replace(/\D/g, '')}`
  }

  async storeSmsOtp(phone: string, code: string): Promise<void> {
    if (this.isTestPhone(phone)) {
      this.logger.warn(`[TEST] Skipping SMS OTP storage for ${phone} — use code: ${this.testCode}`)
      return
    }
    await this.redis.set(this.smsKey(phone), code, 'EX', OTP_TTL_SECONDS)
    this.logger.log(`SMS OTP stored for ${phone}`)
  }

  async storeEmailOtp(email: string, code: string, ttlSeconds: number = OTP_TTL_SECONDS): Promise<void> {
    const key = email.toLowerCase().trim()
    await this.redis.set(this.emailKey(key), code, 'EX', ttlSeconds)
    this.logger.log(`Email OTP stored for ${key} (${ttlSeconds}s TTL)`)
    if (this.isTestEmail(key)) {
      this.logger.warn(
        `[TEST] Email OTP also accepts bypass code ${this.testCode} for ${this.bareEmail(key)}`,
      )
    }
  }

  async verifySmsOtp(phone: string, code: string): Promise<boolean> {
    if (this.isTestPhone(phone)) {
      const ok = code === this.testCode
      this.logger.warn(
        `[TEST] SMS OTP check for ${phone}: submitted=${code} expected=${this.testCode} → ${ok ? 'PASS' : 'FAIL'}`,
      )
      return ok
    }
    const stored = await this.redis.get(this.smsKey(phone))
    if (!stored || stored !== code) return false
    await this.redis.del(this.smsKey(phone))
    return true
  }

  async verifyEmailOtp(email: string, code: string): Promise<boolean> {
    const key = email.toLowerCase().trim()
    // Dev bypass still accepts TEST_OTP_CODE, but emailed codes work too
    if (this.isTestEmail(key) && code === this.testCode) {
      this.logger.warn(`[TEST] Email OTP bypass accepted for ${this.bareEmail(key)}`)
      await this.redis.del(this.emailKey(key))
      return true
    }
    const stored = await this.redis.get(this.emailKey(key))
    if (!stored || stored !== code) return false
    await this.redis.del(this.emailKey(key))
    return true
  }

  async checkAndIncrementAttempts(identifier: string): Promise<boolean> {
    if (
      this.bypassOtp &&
      (this.testPhones.includes(identifier) ||
        this.testEmails.includes(this.bareEmail(identifier)))
    ) {
      return true
    }
    const key = this.attemptsKey(identifier)
    const attempts = await this.redis.incr(key)
    if (attempts === 1) {
      await this.redis.expire(key, OTP_TTL_SECONDS)
    }
    return attempts <= OTP_MAX_ATTEMPTS
  }

  async clearAttempts(identifier: string): Promise<void> {
    await this.redis.del(this.attemptsKey(identifier))
  }

  private emailVerifiedKey(email: string) {
    return `email_verified:${email.toLowerCase().trim()}`
  }

  /** Set after successful registration OTP verify — required before register(). */
  async markEmailVerified(email: string): Promise<void> {
    await this.redis.set(this.emailVerifiedKey(email), '1', 'EX', OTP_TTL_SECONDS)
  }

  /** Returns true and deletes the flag (one-time use). */
  async consumeEmailVerified(email: string): Promise<boolean> {
    const key = this.emailVerifiedKey(email)
    const ok = await this.redis.get(key)
    if (!ok) return false
    await this.redis.del(key)
    return true
  }
}
