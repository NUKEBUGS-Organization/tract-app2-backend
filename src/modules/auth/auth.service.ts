import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  BadRequestException,
  NotFoundException,
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
import { ResendService } from '../notifications/resend.service'
import { OtpService } from './otp.service'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { UserRole, APP2_ALLOWED_ROLES } from '../../common/enums/user-role.enum'

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly twilioService: TwilioService,
    private readonly resendService: ResendService,
    private readonly otpService: OtpService,
  ) {}

  // ── Token helpers ─────────────────────────────
  private signAccessToken(userId: string, email: string, role: string): string {
    return this.jwtService.sign(
      { sub: userId, email, role },
      {
        secret:
          this.configService.get<string>('jwt.accessSecret') ?? 'dev_access_secret_not_for_production',
        expiresIn: (this.configService.get<string>('jwt.accessExpiresIn') ?? '15m') as SignOptions['expiresIn'],
      },
    )
  }

  private signRefreshToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, jti: randomUUID() },
      {
        secret:
          this.configService.get<string>('jwt.refreshSecret') ?? 'dev_refresh_secret_not_for_production',
        expiresIn: (this.configService.get<string>('jwt.refreshExpiresIn') ?? '7d') as SignOptions['expiresIn'],
      },
    )
  }

  private buildTokenPair(user: UserDocument) {
    const accessToken = this.signAccessToken(user._id.toString(), user.email, user.role)
    const refreshToken = this.signRefreshToken(user._id.toString())
    return { accessToken, refreshToken }
  }

  // ── Sanitize user for API response ────────────
  sanitizeUser(user: UserDocument) {
    const u = user as UserDocument & {
      createdAt?: Date
      updatedAt?: Date
    }
    return {
      id: u._id.toString(),
      email: u.email,
      phone: u.phone,
      role: u.role,
      fullName: u.fullName,
      stateCode: u.stateCode ?? '',
      kycStatus: u.kycStatus ?? 'pending',
      kycVerifiedAt: u.kycVerifiedAt ?? null,
      bankVerified: u.bankVerified,
      reliabilityScore: u.reliabilityScore,
      professionalScore: u.professionalScore,
      isBanned: u.isBanned,
      banReason: u.banReason ?? null,
      scoreRestrictedUntil: u.scoreRestrictedUntil ?? null,
      // App 2 specific
      app2_activeDealsCount: u.app2_activeDealsCount ?? 0,
      app2_totalDealsClosed: u.app2_totalDealsClosed ?? 0,
      app2_isVettedBuyer: u.app2_isVettedBuyer ?? false,
      app2_reactivationFeePending: u.app2_reactivationFeePending ?? false,
      app2_platformFeePaid: u.app2_platformFeePaid ?? false,
      // Realtor fields
      licenseNumber: u.licenseNumber || null,
      brokerageName: u.brokerageName || null,
      commissionPct: u.commissionPct ?? null,
      defaultAgencyRole: u.defaultAgencyRole ?? null,
      // Timestamps
      lastActiveAt: u.lastActiveAt?.toISOString() ?? null,
      createdAt: u.createdAt?.toISOString() ?? new Date().toISOString(),
    }
  }

  // ── Send OTP ──────────────────────────────────
  async sendOtp(phone: string, email: string): Promise<void> {
    try {
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
        : this.resendService.sendOtp(normalizedEmail, emailCode)

      // SMS failure should NOT block email delivery
      const [smsResult, emailResult] = await Promise.allSettled([smsPromise, emailPromise])

      if (smsResult.status === 'rejected') {
        this.logger.error(`SMS delivery failed to ${phone}: ${smsResult.reason}`)
      }
      if (emailResult.status === 'rejected') {
        this.logger.error(`Email delivery failed to ${normalizedEmail}: ${emailResult.reason}`)
      }

      this.logger.log(`OTPs sent to ${phone} / ${normalizedEmail}`)
    } catch (err) {
      this.logger.error('sendOtp failed:', err)
      throw new InternalServerErrorException('Failed to send verification codes. Please try again.')
    }
  }

  // ── Verify OTP ────────────────────────────────
  async verifyOtp(phone: string, email: string, smsOtp: string, emailOtp: string): Promise<boolean> {
    try {
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
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof UnauthorizedException) throw err

      this.logger.error('verifyOtp failed:', err)
      throw new InternalServerErrorException('Verification failed. Please try again.')
    }
  }

  // ── Register ──────────────────────────────────
  async register(dto: RegisterDto): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    try {
      const email = dto.email.toLowerCase().trim()
      const phone = dto.phone.trim()

      // Check App 2 role guard
      if (!APP2_ALLOWED_ROLES.includes(dto.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot register on the Marketplace. Please use the Acquisition platform.',
        )
      }

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
        stateCode: dto.stateCode?.toUpperCase() ?? '',
        dob: dto.dob ? new Date(dto.dob) : null,
        kycStatus: 'pending',
        kycVerifiedAt: null,
        kycProvider: null,
        bankVerified: false,
        reliabilityScore: 100,
        professionalScore: 100,
        isBanned: false,
        lastActiveAt: new Date(),
        // App 2 specific defaults
        app2_activeDealsCount: 0,
        app2_totalDealsClosed: 0,
        app2_isVettedBuyer: false,
        app2_reactivationFeePending: false,
        app2_platformFeePaid: false,
        app2_totalPlatformFeesPaid: 0,
      })

      const { accessToken, refreshToken } = this.buildTokenPair(user)

      await this.userModel.findByIdAndUpdate(user._id, {
        refreshToken: await bcrypt.hash(refreshToken, 10),
      })

      this.logger.log(`New user registered: ${user.email} (${user.role})`)

      const fresh = await this.userModel.findById(user._id)
      return {
        user: this.sanitizeUser(fresh as UserDocument),
        accessToken,
        refreshToken,
      }
    } catch (err) {
      if (err instanceof ConflictException || err instanceof ForbiddenException) throw err

      this.logger.error('register failed:', err)
      throw new InternalServerErrorException('Registration failed. Please try again.')
    }
  }

  // ── Login ─────────────────────────────────────
  async login(dto: LoginDto): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    try {
      const user = await this.userModel
        .findOne({ email: dto.email.toLowerCase().trim() })
        .select('+password')

      if (!user) {
        throw new UnauthorizedException('Invalid email or password.')
      }

      // App 2 role guard — sellers cannot login here
      if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }

      // Global ban check
      if (user.isBanned) {
        const reason = user.banReason ?? 'Policy violation'
        const expiry = user.banExpiresAt ? ` Ban expires: ${user.banExpiresAt.toLocaleDateString()}` : ' This ban is permanent.'
        throw new ForbiddenException(`Your account has been suspended. Reason: ${reason}.${expiry}`)
      }

      const passwordOk = await bcrypt.compare(dto.password, user.password)
      if (!passwordOk) {
        throw new UnauthorizedException('Invalid email or password.')
      }

      // Score restriction check
      if (user.scoreRestrictedUntil && new Date() < user.scoreRestrictedUntil) {
        const until = user.scoreRestrictedUntil.toLocaleDateString()
        throw new ForbiddenException(
          `Your account is restricted until ${until} due to a low reliability score.`,
        )
      }

      const { accessToken, refreshToken } = this.buildTokenPair(user)

      await this.userModel.findByIdAndUpdate(user._id, {
        refreshToken: await bcrypt.hash(refreshToken, 10),
        lastActiveAt: new Date(),
      })

      const fresh = await this.userModel.findById(user._id)
      return {
        user: this.sanitizeUser(fresh as UserDocument),
        accessToken,
        refreshToken,
      }
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err

      this.logger.error('login failed:', err)
      throw new InternalServerErrorException('Login failed. Please try again.')
    }
  }

  // ── Refresh token ─────────────────────────────
  async refresh(userId: string, rawRefreshToken: string): Promise<{ accessToken: string }> {
    try {
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
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err

      this.logger.error('refresh failed:', err)
      throw new InternalServerErrorException('Session refresh failed. Please log in again.')
    }
  }

  // ── Refresh from cookie ───────────────────────
  async refreshFromCookie(rawRefresh: string): Promise<{ accessToken: string }> {
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string }>(rawRefresh, {
        secret:
          this.configService.get<string>('jwt.refreshSecret') ?? 'dev_refresh_secret_not_for_production',
      })
      return this.refresh(payload.sub, rawRefresh)
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err

      this.logger.error('refreshFromCookie failed:', err)
      throw new UnauthorizedException('Session expired. Please log in.')
    }
  }

  // ── Logout ────────────────────────────────────
  async logout(userId: string): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        refreshToken: null,
      })
      this.logger.log(`User ${userId} logged out`)
    } catch (err) {
      // Non-critical — log but don't throw
      this.logger.error(`logout failed for ${userId}:`, err)
    }
  }

  // ── Get me ────────────────────────────────────
  async getMe(userId: string) {
    try {
      const user = await this.userModel.findById(userId)
      if (!user) throw new UnauthorizedException('User not found.')
      return this.sanitizeUser(user)
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err

      this.logger.error('getMe failed:', err)
      throw new InternalServerErrorException('Failed to fetch user profile.')
    }
  }

  // ── Forgot password ───────────────────────────
  async forgotPassword(email: string): Promise<void> {
    try {
      const normalizedEmail = email.toLowerCase().trim()
      const user = await this.userModel.findOne({
        email: normalizedEmail,
      })

      // Always return silently — prevent email enumeration
      if (!user) {
        this.logger.log(`Forgot password: no account for ${normalizedEmail}`)
        return
      }

      const resetToken = Math.floor(100000 + Math.random() * 900000).toString()

      await this.otpService.storeEmailOtp(`reset:${normalizedEmail}`, resetToken, 900) // 15 minutes

      const subject = 'Reset your TRACT password'
      const html = `
        <div style="font-family:Inter,sans-serif;
          max-width:480px;margin:0 auto;padding:40px;">
          <h1 style="font-family:Georgia,serif;
            color:#2D5016;font-size:28px;">TRACT</h1>
          <p style="color:#6B7280;font-size:16px;
            margin-top:24px;">
            Your password reset code:
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
            Expires in 15 minutes. Do not share this code.
          </p>
        </div>
      `

      await this.resendService.sendMail(normalizedEmail, subject, html)

      this.logger.log(`Password reset code sent to ${normalizedEmail}`)
    } catch (err) {
      // Non-critical — log but don't expose
      this.logger.error('forgotPassword failed:', err)
    }
  }

  // ── Change password (authenticated) ───────────
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.userModel.findById(userId).select('+password').exec()
    if (!user) {
      throw new NotFoundException('User not found.')
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.password)
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect.')
    }

    user.password = await bcrypt.hash(dto.newPassword, 12)
    user.refreshToken = null
    await user.save()

    return { message: 'Password updated successfully.' }
  }

  // ── Reset password ────────────────────────────
  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    try {
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
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err

      this.logger.error('resetPassword failed:', err)
      throw new InternalServerErrorException('Password reset failed. Please try again.')
    }
  }

  /** Jumio OAuth2 → create account (same flow as tract-app1-backend); returns Web SDK token. */
  async initiateKyc(userId: string): Promise<{ kyc_access_token: string }> {
    const clientId = this.configService.get<string>('jumio.apiKey') ?? ''
    const clientSecret = this.configService.get<string>('jumio.apiSecret') ?? ''
    const callbackUrl = (
      this.configService.get<string>('jumio.callbackUrl') ?? ''
    ).trim()
    const workflowKey = this.configService.get<number>('jumio.workflowDefinitionKey') ?? 10547

    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException('KYC configuration credentials missing')
    }
    if (!callbackUrl) {
      throw new InternalServerErrorException(
        'KYC callback URL missing: set JUMIO_CALLBACK_URL or API_PUBLIC_URL',
      )
    }

    const existing = await this.userModel.findById(userId).lean()
    if (!existing) {
      throw new UnauthorizedException('User not found.')
    }
    if (existing.kycStatus === 'approved') {
      throw new BadRequestException('Identity verification is already complete.')
    }

    try {
      const authString = Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64')

      const jumioResponse = await fetch('https://auth.amer-1.jumio.ai/oauth2/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${authString}`,
        },
        body: 'grant_type=client_credentials',
      })

      if (!jumioResponse.ok) {
        throw new InternalServerErrorException(
          `Jumio Auth failed: ${jumioResponse.statusText}`,
        )
      }

      const data = (await jumioResponse.json()) as { access_token?: string }

      if (!data.access_token) {
        throw new InternalServerErrorException('No Access Token found')
      }

      const sessionResponse = await fetch(
        'https://account.amer-1.jumio.ai/api/v1/accounts',
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${data.access_token}`,
          },
          body: JSON.stringify({
            customerInternalReference: userId,
            callbackUrl,
            workflowDefinition: {
              key: workflowKey,
            },
          }),
        },
      )

      if (!sessionResponse.ok) {
        const errBody = await sessionResponse.json().catch(() => ({}))
        throw new InternalServerErrorException(
          `Jumio Session failed: ${sessionResponse.statusText}. ${JSON.stringify(errBody)}`,
        )
      }

      const sessionData = (await sessionResponse.json()) as { sdk?: { token?: string } }
      const reactSdkToken = sessionData?.sdk?.token

      if (!reactSdkToken) {
        throw new InternalServerErrorException('SDK token missing from Jumio response')
      }

      return { kyc_access_token: reactSdkToken }
    } catch (err) {
      if (
        err instanceof InternalServerErrorException ||
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err
      }
      throw new InternalServerErrorException(
        `Failed to initiate KYC session: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    }
  }

  async handleKycWebhook(payload: Record<string, unknown>): Promise<{ received: true }> {
    try {
      const rawCustomerId =
        typeof payload?.customerId === 'string'
          ? payload.customerId
          : typeof payload?.customerInternalReference === 'string'
            ? payload.customerInternalReference
            : ''
      const customerId = rawCustomerId.trim()
      const verificationStatus =
        typeof payload?.verificationStatus === 'string' ? payload.verificationStatus : undefined

      if (!customerId) {
        throw new BadRequestException(
          'Missing customerId (or customerInternalReference) in KYC webhook payload',
        )
      }

      const kycStatus: 'approved' | 'rejected' =
        verificationStatus === 'APPROVED_VERIFIED' ? 'approved' : 'rejected'

      const updated = await this.userModel
        .findByIdAndUpdate(customerId, {
          $set: {
            kycStatus,
            kycVerifiedAt: kycStatus === 'approved' ? new Date() : null,
            kycProvider: 'jumio',
          },
        })
        .exec()

      if (!updated) {
        this.logger.warn(`KYC webhook: no user found for id ${customerId}`)
      }

      return { received: true }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      const message = err instanceof Error ? err.message : String(err)
      this.logger.error(`handleKycWebhook error: ${message}`)
      throw new InternalServerErrorException('KYC webhook processing failed')
    }
  }
}
