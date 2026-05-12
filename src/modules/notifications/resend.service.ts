import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Resend } from 'resend'

@Injectable()
export class ResendService implements OnModuleInit {
  private client!: Resend
  private readonly from: string
  private readonly logger = new Logger(ResendService.name)

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('resend.apiKey') ?? ''
    this.from = config.get<string>('resend.from') ?? 'TRACT <onboarding@resend.dev>'
    this.client = new Resend(apiKey)
  }

  async onModuleInit() {
    const apiKey = this.config.get<string>('resend.apiKey') ?? ''
    if (!apiKey || !apiKey.startsWith('re_')) {
      this.logger.warn(
        'RESEND_API_KEY is not set or invalid — email delivery will fail in production',
      )
    } else {
      this.logger.log('Resend email service ready')
    }
  }

  async sendMail(to: string, subject: string, html: string, text?: string): Promise<boolean> {
    try {
      const { error } = await this.client.emails.send({
        from: this.from,
        to: [to],
        subject,
        html,
        text: text ?? subject,
      })

      if (error) {
        this.logger.error(`Resend error to ${to}: ${error.message}`)
        return false
      }

      this.logger.log(`Email sent to ${to} via Resend`)
      return true
    } catch (err) {
      this.logger.error(`Resend failed to ${to}:`, err)
      return false
    }
  }

  async sendOtp(to: string, code: string): Promise<boolean> {
    const subject = 'Your TRACT Verification Code'

    const text =
      `Your TRACT verification code is: ${code}\n\n` +
      `Valid for 10 minutes. Do not share this code.\n\n` +
      `If you did not request this, ignore this email.`

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport"
    content="width=device-width,initial-scale=1"/>
</head>
<body style="margin:0;padding:0;
  background-color:#F5F5F1;
  font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
    style="background-color:#F5F5F1;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0"
          cellspacing="0"
          style="max-width:480px;
          background-color:#ffffff;
          border-radius:12px;
          overflow:hidden;
          box-shadow:0 4px 20px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#0B0E11;
              padding:32px 40px;">
              <p style="margin:0;
                font-family:Georgia,serif;
                font-size:28px;font-weight:700;
                color:#D4AF37;
                letter-spacing:-0.5px;">
                TRACT
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 8px;
                font-size:16px;color:#6B7280;
                font-weight:400;">
                Your verification code is:
              </p>
              <p style="margin:0 0 4px;
                font-size:14px;color:#9CA3AF;">
                Valid for 10 minutes.
                Do not share this code.
              </p>

              <!-- Code Box -->
              <table width="100%" cellpadding="0"
                cellspacing="0"
                style="margin:24px 0;">
                <tr>
                  <td align="center"
                    style="background-color:#F5F5F1;
                    border:2px solid #D4AF37;
                    border-radius:8px;
                    padding:24px;">
                    <span style="font-size:48px;
                      font-weight:700;
                      letter-spacing:16px;
                      color:#0B0E11;
                      font-family:Georgia,serif;">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;
                color:#9CA3AF;line-height:1.6;">
                If you did not request this code,
                you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#F9FAFB;
              padding:24px 40px;
              border-top:1px solid #E5E7EB;">
              <p style="margin:0;font-size:12px;
                color:#9CA3AF;line-height:1.6;">
                © 2025 TRACT Private Marketplace.
                All rights reserved.<br/>
                This is an automated message.
                Please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `

    return this.sendMail(to, subject, html, text)
  }
}
