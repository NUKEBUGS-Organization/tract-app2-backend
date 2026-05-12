import { Injectable, Inject, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Redis from 'ioredis'
import { REDIS_CLIENT } from '../../database/redis.module'

const OTP_TTL_SECONDS = 600
const OTP_MAX_ATTEMPTS = 5

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

  /** Public for AuthService (dev bypass SMS skip). */
  isTestPhone(phone: string): boolean {
    return this.bypassOtp && this.testPhones.includes(phone)
  }

  /** Public for AuthService (dev bypass email skip). */
  isTestEmail(email: string): boolean {
    return this.bypassOtp && this.testEmails.includes(email.toLowerCase().trim())
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

  async storeEmailOtp(email: string, code: string): Promise<void> {
    const normalised = email.toLowerCase().trim()
    if (this.isTestEmail(normalised)) {
      this.logger.warn(`[TEST] Skipping email OTP storage for ${normalised} — use code: ${this.testCode}`)
      return
    }
    await this.redis.set(this.emailKey(normalised), code, 'EX', OTP_TTL_SECONDS)
    this.logger.log(`Email OTP stored for ${normalised}`)
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
    const normalised = email.toLowerCase().trim()
    if (this.isTestEmail(normalised)) {
      const ok = code === this.testCode
      this.logger.warn(
        `[TEST] Email OTP check for ${normalised}: submitted=${code} expected=${this.testCode} → ${ok ? 'PASS' : 'FAIL'}`,
      )
      return ok
    }
    const stored = await this.redis.get(this.emailKey(normalised))
    if (!stored || stored !== code) return false
    await this.redis.del(this.emailKey(normalised))
    return true
  }

  async checkAndIncrementAttempts(identifier: string): Promise<boolean> {
    if (
      this.bypassOtp &&
      (this.testPhones.includes(identifier) || this.testEmails.includes(identifier.toLowerCase().trim()))
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
}
