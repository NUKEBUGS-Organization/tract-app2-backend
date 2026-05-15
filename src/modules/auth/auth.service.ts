import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Logger,
  ForbiddenException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { SignOptions } from 'jsonwebtoken'
import { ConfigService } from '@nestjs/config'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import * as bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

import { User, UserDocument } from '../users/schemas/user.schema'
import { TwilioService } from '../notifications/twilio.service'
import { MailService } from '../notifications/mail.service'
import { OtpService } from './otp.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { KycWebhookDto } from './dto/kyc-webhook.dto'
import { UserRole } from '../../common/enums/user-role.enum'
import { KycStatus } from '../../common/enums/kyc-status.enum'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private twilioService: TwilioService,
    private mailService: MailService,
    private otpService: OtpService,
  ) {}

  private signAccessToken(userId: string, email: string, role: string): string {
    return this.jwtService.sign(
      { sub: userId, email, role },
      {
        secret: this.configService.get<string>('jwt.accessSecret') ?? 'dev_access_secret_not_for_production',
        expiresIn: (this.configService.get<string>('jwt.accessExpiresIn') ?? '15m') as SignOptions['expiresIn'],
      },
    )
  }

  private signRefreshToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, jti: randomUUID() },
      {
        secret: this.configService.get<string>('jwt.refreshSecret') ?? 'dev_refresh_secret_not_for_production',
        expiresIn: (this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d') as SignOptions['expiresIn'],
      },
    )
  }

  private buildTokenPair(user: UserDocument) {
    const accessToken = this.signAccessToken(user._id.toString(), user.email, user.role)
    const refreshToken = this.signRefreshToken(user._id.toString())
    return { accessToken, refreshToken }
  }

  sanitizeUser(user: UserDocument) {
    const u = user as UserDocument & { createdAt?: Date; updatedAt?: Date }
    const lastActive =
      u.lastActiveAt instanceof Date ? u.lastActiveAt.toISOString() : new Date().toISOString()
    const created =
      u.createdAt instanceof Date ? u.createdAt.toISOString() : new Date().toISOString()
    return {
      id: u._id.toString(),
      email: u.email,
      phone: u.phone,
      role: u.role,
      fullName: u.fullName,
      kycStatus: u.kycStatus,
      bankVerified: u.bankVerified,
      reliabilityScore: u.reliabilityScore,
      professionalScore: u.professionalScore,
      activeDealsCount: u.activeDealsCount,
      isBanned: u.isBanned,
      lastActiveAt: lastActive,
      createdAt: created,
    }
  }

  async sendOtp(phone: string, email: string): Promise<void> {
    const smsCode = this.otpService.generate()
    const emailCode = this.otpService.generate()
    const normalizedEmail = email.toLowerCase().trim()

    await Promise.all([
      this.otpService.storeSmsOtp(phone, smsCode),
      this.otpService.storeEmailOtp(normalizedEmail, emailCode),
    ])

    const smsPromise = this.otpService.isTestPhone(phone)
      ? Promise.resolve(true)
      : this.twilioService.sendOtp(phone, smsCode)

    const emailPromise = this.otpService.isTestEmail(normalizedEmail)
      ? Promise.resolve(true)
      : this.mailService.sendOtp(normalizedEmail, emailCode)

    await Promise.all([smsPromise, emailPromise])

    this.logger.log(`OTPs sent to ${phone} / ${normalizedEmail}`)
  }

  async verifyOtp(phone: string, email: string, smsOtp: string, emailOtp: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim()
    const allowed = await this.otpService.checkAndIncrementAttempts(phone)
    if (!allowed) {
      throw new ForbiddenException('Too many attempts. Please request a new code.')
    }

    const [smsOk, emailOk] = await Promise.all([
      this.otpService.verifySmsOtp(phone, smsOtp),
      this.otpService.verifyEmailOtp(normalizedEmail, emailOtp),
    ])

    if (!smsOk || !emailOk) {
      throw new UnauthorizedException('Incorrect verification code.')
    }

    await this.otpService.clearAttempts(phone)
    return true
  }

  async register(dto: RegisterDto): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    const email = dto.email.toLowerCase().trim()
    const phone = dto.phone.trim()
    const existing = await this.userModel.findOne({
      $or: [{ email }, { phone }],
    })
    if (existing) {
      throw new ConflictException('An account with this email or phone already exists.')
    }

    const hashed = await bcrypt.hash(dto.password, 12)

    const user = await this.userModel.create({
      fullName: dto.fullName.trim(),
      email,
      phone,
      password: hashed,
      role: dto.role as UserRole,
      stateCode: dto.stateCode.toUpperCase(),
      dob: new Date(dto.dob),
      kycStatus: KycStatus.PENDING,
      bankVerified: false,
      reliabilityScore: 100,
      professionalScore: 100,
      activeDealsCount: 0,
      totalDealsClosed: 0,
      isBanned: false,
      lastActiveAt: new Date(),
    })

    const { accessToken, refreshToken } = this.buildTokenPair(user)

    await this.userModel.findByIdAndUpdate(user._id, {
      refreshToken: await bcrypt.hash(refreshToken, 10),
    })

    this.logger.log(`New user registered: ${user.email} (${user.role})`)

    const fresh = (await this.userModel.findById(user._id)) as UserDocument
    return {
      user: this.sanitizeUser(fresh),
      accessToken,
      refreshToken,
    }
  }

  async login(dto: LoginDto): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    const user = await this.userModel
      .findOne({ email: dto.email.toLowerCase().trim() })
      .select('+password')

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.')
    }

    if (user.isBanned) {
      throw new ForbiddenException(
        `Your account has been suspended. Reason: ${user.banReason ?? 'Policy violation'}`,
      )
    }

    const passwordOk = await bcrypt.compare(dto.password, user.password)
    if (!passwordOk) {
      throw new UnauthorizedException('Invalid email or password.')
    }

    const { accessToken, refreshToken } = this.buildTokenPair(user)

    await this.userModel.findByIdAndUpdate(user._id, {
      refreshToken: await bcrypt.hash(refreshToken, 10),
      lastActiveAt: new Date(),
    })

    const fresh = (await this.userModel.findById(user._id)) as UserDocument
    return {
      user: this.sanitizeUser(fresh),
      accessToken,
      refreshToken,
    }
  }

  async refresh(userId: string, rawRefreshToken: string): Promise<{ accessToken: string }> {
    const user = await this.userModel.findById(userId).select('+refreshToken')

    if (!user?.refreshToken) {
      throw new UnauthorizedException('Session expired. Please log in.')
    }

    const tokenOk = await bcrypt.compare(rawRefreshToken, user.refreshToken)
    if (!tokenOk) {
      throw new UnauthorizedException('Invalid session. Please log in.')
    }

    const accessToken = this.signAccessToken(user._id.toString(), user.email, user.role)
    return { accessToken }
  }

  async refreshFromCookie(rawRefresh: string): Promise<{ accessToken: string }> {
    let sub: string
    try {
      const p = await this.jwtService.verifyAsync<{ sub: string }>(rawRefresh, {
        secret: this.configService.get<string>('jwt.refreshSecret') ?? 'dev_refresh_secret_not_for_production',
      })
      sub = p.sub
    } catch {
      throw new UnauthorizedException('Session expired. Please log in.')
    }
    return this.refresh(sub, rawRefresh)
  }

  async logout(userId: string): Promise<void> {
    await this.userModel.findByIdAndUpdate(userId, {
      refreshToken: null,
    })
  }

  async getMe(userId: string) {
    const user = await this.userModel.findById(userId)
    if (!user) throw new UnauthorizedException()
    return this.sanitizeUser(user)
  }

  async forgotPassword(email: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim()

    const user = await this.userModel.findOne({
      email: normalizedEmail,
    })

    if (!user) {
      this.logger.log(`Forgot password: no account for ${normalizedEmail}`)
      return
    }

    const resetToken = Math.floor(100000 + Math.random() * 900000).toString()

    await this.otpService.storeEmailOtp(`reset:${normalizedEmail}`, resetToken, 900)

    const subject = 'Reset your TRACT password'
    const html = `
    <div style="font-family:Inter,sans-serif;
      max-width:480px;margin:0 auto;padding:40px;">
      <h1 style="font-family:Georgia,serif;
        color:#2D5016;font-size:28px;">TRACT</h1>
      <p style="color:#6B7280;font-size:16px;
        margin-top:24px;">
        You requested a password reset.
        Your reset code is:
      </p>
      <div style="background:#F5F5F1;
        border:2px solid #D4AF37;
        border-radius:8px;padding:24px;
        text-align:center;margin:24px 0;">
        <span style="font-size:40px;font-weight:700;
          letter-spacing:12px;color:#0B0E11;
          font-family:Georgia,serif;">
          ${resetToken}
        </span>
      </div>
      <p style="color:#9CA3AF;font-size:14px;">
        This code expires in 15 minutes.
        If you did not request this, ignore this email.
      </p>
    </div>
  `

    await this.mailService.sendMail(normalizedEmail, subject, html)

    this.logger.log(`Password reset code sent to ${normalizedEmail}`)
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim()

    const isValid = await this.otpService.verifyEmailOtp(`reset:${normalizedEmail}`, token)

    if (!isValid) {
      throw new UnauthorizedException('Invalid or expired reset code.')
    }

    const user = await this.userModel.findOne({
      email: normalizedEmail,
    })

    if (!user) {
      throw new UnauthorizedException('Account not found.')
    }

    const hashed = await bcrypt.hash(newPassword, 12)
    await this.userModel.findByIdAndUpdate(user._id, {
      password: hashed,
      refreshToken: null,
    })

    this.logger.log(`Password reset successful for ${normalizedEmail}`)
  }

  /**
   * OAuth2 client credentials → create Jumio account → return SDK token for the Web client / mobile SDK.
   * Mirrors tract-app1-backend: sessionData.sdk.token as kyc_access_token.
   */
  async initiateKyc(userId: string): Promise<{ kyc_access_token: string }> {
    const clientId = this.configService.get<string>('jumio.apiKey') ?? ''
    const clientSecret = this.configService.get<string>('jumio.apiSecret') ?? ''
    const oauthTokenUrl = this.configService.get<string>('jumio.oauthTokenUrl') ?? ''
    const accountsUrl = this.configService.get<string>('jumio.accountsUrl') ?? ''
    const callbackUrl = this.configService.get<string>('jumio.callbackUrl') ?? ''
    const workflowKey = this.configService.get<number>('jumio.workflowDefinitionKey') ?? 10547

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('KYC configuration credentials missing')
    }

    try {
      const authString = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

      const jumioAuthRes = await fetch(oauthTokenUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${authString}`,
        },
        body: 'grant_type=client_credentials',
      })

      if (!jumioAuthRes.ok) {
        const text = await jumioAuthRes.text()
        this.logger.warn(`Jumio OAuth failed: ${jumioAuthRes.status} ${text}`)
        throw new InternalServerErrorException('Jumio authentication failed')
      }

      const tokenJson = (await jumioAuthRes.json()) as { access_token?: string }
      if (!tokenJson.access_token) {
        throw new InternalServerErrorException('No access token from Jumio')
      }

      const accountBody: Record<string, unknown> = {
        customerInternalReference: userId,
        workflowDefinition: {
          key: workflowKey,
        },
      }
      if (callbackUrl.trim()) {
        accountBody.callbackUrl = callbackUrl.trim()
      }

      const sessionRes = await fetch(accountsUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenJson.access_token}`,
        },
        body: JSON.stringify(accountBody),
      })

      if (!sessionRes.ok) {
        const text = await sessionRes.text()
        this.logger.warn(`Jumio account creation failed: ${sessionRes.status} ${text}`)
        throw new InternalServerErrorException('Jumio session creation failed')
      }

      const sessionData = (await sessionRes.json()) as {
        sdk?: { token?: string }
        account?: { id?: string }
      }
      const reactSdkToken = sessionData?.sdk?.token

      if (!reactSdkToken) {
        this.logger.warn(
          `Jumio response missing sdk.token; account=${sessionData?.account?.id ?? 'unknown'}`,
        )
        throw new InternalServerErrorException('SDK token missing from Jumio response')
      }

      this.logger.log(`Jumio KYC initiated for user ${userId} (account ${sessionData?.account?.id ?? '?'})`)

      return { kyc_access_token: reactSdkToken }
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err
      this.logger.error('initiateKyc failed', err instanceof Error ? err.stack : err)
      throw new InternalServerErrorException('Could not start KYC verification')
    }
  }

  /**
   * Public webhook: minimal payload { customerId | customerInternalReference, verificationStatus }.
   * APPROVED_VERIFIED → verified; anything else → rejected.
   */
  async handleKycWebhook(payload: KycWebhookDto): Promise<{ received: true }> {
    const customerId = payload.customerId ?? payload.customerInternalReference

    if (!customerId) {
      throw new BadRequestException('Missing customerId in KYC webhook payload')
    }

    const kycStatus =
      payload.verificationStatus === 'APPROVED_VERIFIED' ? KycStatus.VERIFIED : KycStatus.REJECTED

    const updated = await this.userModel.findByIdAndUpdate(customerId, { $set: { kycStatus } }).exec()

    if (!updated) {
      this.logger.warn(`KYC webhook: no user found for id ${customerId}`)
    } else {
      this.logger.log(`KYC webhook: user ${customerId} → ${kycStatus}`)
    }

    return { received: true }
  }
}
