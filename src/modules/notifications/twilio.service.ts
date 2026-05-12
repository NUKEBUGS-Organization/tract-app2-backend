import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import twilio from 'twilio'

@Injectable()
export class TwilioService {
  private readonly client: ReturnType<typeof twilio> | null
  private readonly messagingServiceSid: string
  private readonly from: string
  private readonly logger = new Logger(TwilioService.name)

  constructor(private readonly config: ConfigService) {
    const sid = config.get<string>('twilio.accountSid') ?? ''
    const token = config.get<string>('twilio.authToken') ?? ''
    this.from = config.get<string>('twilio.phoneNumber') ?? ''
    this.messagingServiceSid = config.get<string>('twilio.messagingServiceSid') ?? ''
    this.client = sid && token ? twilio(sid, token) : null
  }

  async sendSms(to: string, body: string): Promise<boolean> {
    if (!this.client) {
      this.logger.warn('Twilio not configured; SMS skipped.')
      return false
    }
    try {
      await this.client.messages.create({
        body,
        messagingServiceSid: this.messagingServiceSid || undefined,
        from: this.messagingServiceSid ? undefined : this.from,
        to,
      })
      this.logger.log(`SMS sent to ${to}`)
      return true
    } catch (err) {
      this.logger.error(`SMS failed to ${to}:`, err)
      return false
    }
  }

  async sendOtp(to: string, code: string): Promise<boolean> {
    const body =
      `Your TRACT verification code is: ${code}. ` +
      `Valid for 10 minutes. Do not share this code.`
    return this.sendSms(to, body)
  }
}
