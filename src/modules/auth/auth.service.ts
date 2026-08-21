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
import { Session, SessionDocument } from '../sessions/schemas/session.schema'
import { ResendService } from '../notifications/resend.service'
import { OtpService } from './otp.service'
import { ChangePasswordDto } from './dto/change-password.dto'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { GoogleCompleteDto } from './dto/google-complete.dto'
import type { GoogleProfile } from './strategies/google.strategy'
import { UserRole, APP2_ALLOWED_ROLES } from '../../common/enums/user-role.enum'
import { KycStatus } from '../../common/enums/kyc-status.enum'

const GOOGLE_SIGNUP_TOKEN_PURPOSE = 'google_signup'
const GOOGLE_SIGNUP_TOKEN_EXPIRES_IN = '10m'

const BCRYPT_ROUNDS = 12
/** Concurrent refresh grace — sibling apps/tabs that race rotation get TOKEN_ROTATED. */
const REFRESH_ROTATION_GRACE_MS = 30_000

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name)

  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly resendService: ResendService,
    private readonly otpService: OtpService,
  ) {}

  // ── Token helpers (session-backed) ────────────
  private async createSession(
    user: UserDocument,
    options?: { rotatingFrom?: SessionDocument },
  ): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    const rotatingFrom = options?.rotatingFrom

    if (!rotatingFrom) {
      await this.sessionModel.updateMany(
        { userId: user._id, isBlacklisted: false },
        {
          isBlacklisted: true,
          blacklistedAt: new Date(),
          rotatedTo: null,
        },
      )
    }

    const sessionId = randomUUID()
    const payload = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      sessionId,
    }

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      expiresIn: (this.configService.get<string>('jwt.accessExpiresIn') ??
        '15m') as SignOptions['expiresIn'],
    })

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      expiresIn: (this.configService.get<string>('jwt.refreshExpiresIn') ??
        '7d') as SignOptions['expiresIn'],
    })

    await this.sessionModel.create({
      userId: user._id,
      sessionId,
      refreshTokenHash: await bcrypt.hash(refreshToken, BCRYPT_ROUNDS),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    if (rotatingFrom) {
      const claimed = await this.sessionModel.findOneAndUpdate(
        { _id: rotatingFrom._id, isBlacklisted: false },
        {
          isBlacklisted: true,
          blacklistedAt: new Date(),
          rotatedTo: sessionId,
        },
        { new: true },
      )

      if (!claimed) {
        await this.sessionModel.deleteOne({ sessionId })
        throw new UnauthorizedException({
          message:
            'Refresh token was rotated by a concurrent request. Retry shortly.',
          code: 'TOKEN_ROTATED',
        })
      }
    }

    await this.userModel.findByIdAndUpdate(user._id, {
      currentSessionId: sessionId,
      lastActiveAt: new Date(),
    })

    const fresh = await this.userModel.findById(user._id)
    return {
      user: this.sanitizeUser(fresh as UserDocument),
      accessToken,
      refreshToken,
    }
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
      avatarUrl: u.avatarUrl ?? null,
      kycStatus: u.kycStatus ?? 'approved',
      kycVerifiedAt: u.kycVerifiedAt ?? null,
      bankVerified: u.bankVerified,
      pofStatus: u.pofStatus ?? 'not_submitted',
      pofDocumentUrl: u.pofDocumentUrl ?? null,
      pofDocumentType: u.pofDocumentType ?? null,
      pofSubmittedAt: u.pofSubmittedAt?.toISOString() ?? null,
      pofApprovedAt: u.pofApprovedAt?.toISOString() ?? null,
      pofRejectionReason: u.pofRejectionReason ?? null,
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
  async sendOtp(email: string): Promise<void> {
    try {
      const emailCode = this.otpService.generate()
      const normalizedEmail = email.toLowerCase().trim()

      await this.otpService.storeEmailOtp(normalizedEmail, emailCode)

      const sent = await this.resendService.sendOtp(normalizedEmail, emailCode)
      if (!sent) {
        this.logger.error(`Email delivery failed to ${normalizedEmail}`)
        throw new InternalServerErrorException('Failed to send verification code. Please try again.')
      }

      this.logger.log(`OTP sent to ${normalizedEmail}`)
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err
      this.logger.error('sendOtp failed:', err)
      throw new InternalServerErrorException('Failed to send verification code. Please try again.')
    }
  }

  // ── Verify OTP ────────────────────────────────
  async verifyOtp(email: string, emailOtp: string): Promise<boolean> {
    try {
      const normalizedEmail = email.toLowerCase().trim()

      const allowed = await this.otpService.checkAndIncrementAttempts(normalizedEmail)
      if (!allowed) {
        throw new ForbiddenException('Too many attempts. Please request a new code.')
      }

      const emailOk = await this.otpService.verifyEmailOtp(normalizedEmail, emailOtp)

      if (!emailOk) {
        throw new UnauthorizedException('Incorrect verification code.')
      }

      await this.otpService.clearAttempts(normalizedEmail)
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
      if (dto.role === UserRole.ADMIN) {
        throw new ForbiddenException(
          'This role cannot be selected during self-registration.',
        )
      }

      const existing = await this.userModel.findOne({
        $or: [{ email }, { phone }],
      })
      if (existing) {
        throw new ConflictException('An account with this email or phone already exists.')
      }

      const hashed = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)

      const user = await this.userModel.create({
        fullName: dto.fullName.trim(),
        email,
        phone,
        passwordHash: hashed,
        role: dto.role as UserRole,
        stateCode: dto.stateCode?.toUpperCase() ?? '',
        dob: dto.dob ? new Date(dto.dob) : null,
        kycStatus: KycStatus.APPROVED,
        kycVerifiedAt: new Date(),
        kycProvider: 'auto',
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

      this.logger.log(`New user registered: ${user.email} (${user.role})`)

      return this.createSession(user)
    } catch (err) {
      if (err instanceof ConflictException || err instanceof ForbiddenException) throw err

      this.logger.error('register failed:', err)
      throw new InternalServerErrorException('Registration failed. Please try again.')
    }
  }

  private issueGoogleSignupToken(profile: {
    googleId: string
    email: string
    fullName: string
    avatarUrl?: string | null
  }) {
    const signupToken = this.jwtService.sign(
      {
        purpose: GOOGLE_SIGNUP_TOKEN_PURPOSE,
        googleId: profile.googleId,
        email: profile.email,
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl ?? null,
      },
      {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
        expiresIn: GOOGLE_SIGNUP_TOKEN_EXPIRES_IN,
      },
    )
    return {
      mode: 'signup' as const,
      signupToken,
      email: profile.email,
      fullName: profile.fullName,
    }
  }

  // ── Google OAuth: existing user login OR new-user signup token ─
  async handleGoogleAuth(profile: GoogleProfile): Promise<
    | { mode: 'login'; user: ReturnType<AuthService['sanitizeUser']>; accessToken: string; refreshToken: string }
    | { mode: 'signup'; signupToken: string; email: string; fullName: string }
  > {
    const email = profile.email.toLowerCase().trim()
    const existing = await this.userModel.findOne({ email })

    if (existing) {
      if (!APP2_ALLOWED_ROLES.includes(existing.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }
      if (existing.isBanned) {
        const reason = existing.banReason ?? 'Policy violation'
        throw new ForbiddenException(`Your account has been suspended. Reason: ${reason}.`)
      }

      // Incomplete profile (legacy / partial docs) — collect phone+role before session.
      if (!existing.phone?.trim()) {
        await this.userModel.findByIdAndUpdate(existing._id, {
          $set: {
            googleId: profile.googleId,
            ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
          },
        })
        return this.issueGoogleSignupToken({
          googleId: profile.googleId,
          email,
          fullName: existing.fullName || profile.fullName,
          avatarUrl: profile.avatarUrl ?? existing.avatarUrl,
        })
      }

      // Never existing.save() here — passwordHash is select:false and re-validation
      // blows up on incomplete shared-collection docs ("phone is required", etc.).
      if (!existing.googleId) {
        await this.userModel.findByIdAndUpdate(existing._id, {
          $set: { googleId: profile.googleId },
        })
      }

      const session = await this.createSession(existing)
      return { mode: 'login', ...session }
    }

    return this.issueGoogleSignupToken({
      googleId: profile.googleId,
      email,
      fullName: profile.fullName,
      avatarUrl: profile.avatarUrl,
    })
  }

  // ── Google OAuth: finish signup (role/phone/state collected client-side) ─
  async completeGoogleSignup(dto: GoogleCompleteDto): Promise<{
    user: ReturnType<AuthService['sanitizeUser']>
    accessToken: string
    refreshToken: string
  }> {
    let payload: {
      purpose?: string
      googleId?: string
      email?: string
      fullName?: string
      avatarUrl?: string | null
    }
    try {
      payload = await this.jwtService.verifyAsync(dto.token, {
        secret: this.configService.getOrThrow<string>('jwt.accessSecret'),
      })
    } catch {
      throw new UnauthorizedException('Your Google sign-up link expired. Please try again.')
    }

    if (payload.purpose !== GOOGLE_SIGNUP_TOKEN_PURPOSE || !payload.email || !payload.googleId) {
      throw new UnauthorizedException('Invalid Google sign-up token.')
    }

    if (!APP2_ALLOWED_ROLES.includes(dto.role as UserRole)) {
      throw new ForbiddenException(
        'Sellers cannot register on the Marketplace. Please use the Acquisition platform.',
      )
    }
    if (dto.role === UserRole.ADMIN) {
      throw new ForbiddenException('This role cannot be selected during self-registration.')
    }

    const email = payload.email.toLowerCase().trim()
    const phone = (dto.phone ?? '').trim()
    if (!phone) {
      throw new BadRequestException('Phone number is required.')
    }

    const byEmail = await this.userModel.findOne({ email })
    const byPhone = await this.userModel.findOne({ phone })

    if (byPhone && (!byEmail || byPhone._id.toString() !== byEmail._id.toString())) {
      throw new ConflictException('An account with this phone already exists.')
    }

    // Finish an incomplete account that already has this email (no phone yet).
    if (byEmail) {
      if (byEmail.phone?.trim()) {
        throw new ConflictException('An account with this email already exists.')
      }

      const updated = await this.userModel
        .findByIdAndUpdate(
          byEmail._id,
          {
            $set: {
              fullName: payload.fullName ?? byEmail.fullName ?? email,
              phone,
              role: dto.role as UserRole,
              stateCode: dto.stateCode.toUpperCase(),
              dob: dto.dob ? new Date(dto.dob) : byEmail.dob,
              googleId: payload.googleId,
              authProvider: 'google',
              avatarUrl: payload.avatarUrl ?? byEmail.avatarUrl ?? null,
              kycStatus: KycStatus.APPROVED,
              kycVerifiedAt: byEmail.kycVerifiedAt ?? new Date(),
              kycProvider: byEmail.kycProvider ?? 'auto',
              lastActiveAt: new Date(),
            },
          },
          { new: true, runValidators: true },
        )
        .exec()

      if (!updated) {
        throw new InternalServerErrorException('Could not finish Google sign-up. Please try again.')
      }

      this.logger.log(`Completed Google profile for existing user: ${updated.email} (${updated.role})`)
      return this.createSession(updated)
    }

    // Google-authenticated accounts never use this hash to sign in — password login stays unreachable.
    const placeholderHash = await bcrypt.hash(randomUUID(), BCRYPT_ROUNDS)

    try {
      const user = await this.userModel.create({
        fullName: payload.fullName ?? email,
        email,
        phone,
        passwordHash: placeholderHash,
        role: dto.role as UserRole,
        stateCode: dto.stateCode.toUpperCase(),
        dob: dto.dob ? new Date(dto.dob) : null,
        googleId: payload.googleId,
        authProvider: 'google',
        avatarUrl: payload.avatarUrl ?? null,
        kycStatus: KycStatus.APPROVED,
        kycVerifiedAt: new Date(),
        kycProvider: 'auto',
        bankVerified: false,
        reliabilityScore: 100,
        professionalScore: 100,
        isBanned: false,
        lastActiveAt: new Date(),
        app2_activeDealsCount: 0,
        app2_totalDealsClosed: 0,
        app2_isVettedBuyer: false,
        app2_reactivationFeePending: false,
        app2_platformFeePaid: false,
        app2_totalPlatformFeesPaid: 0,
      })

      this.logger.log(`New user registered via Google: ${user.email} (${user.role})`)
      return this.createSession(user)
    } catch (err) {
      if (err instanceof ConflictException || err instanceof ForbiddenException || err instanceof BadRequestException) {
        throw err
      }
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('phone') && msg.includes('required')) {
        throw new BadRequestException('Phone number is required to finish Google sign-up.')
      }
      this.logger.error('completeGoogleSignup failed:', err)
      throw new InternalServerErrorException('Registration failed. Please try again.')
    }
  }

  // ── Login (step 1: password → send 2FA OTP) ───
  async login(dto: LoginDto): Promise<{ message: string }> {
    try {
      const user = await this.userModel
        .findOne({ email: dto.email.toLowerCase().trim() })
        .select('+passwordHash')

      if (!user) {
        throw new UnauthorizedException('Invalid email or password.')
      }

      if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }

      if (user.isBanned) {
        const reason = user.banReason ?? 'Policy violation'
        const expiry = user.banExpiresAt
          ? ` Ban expires: ${user.banExpiresAt.toLocaleDateString()}`
          : ' This ban is permanent.'
        throw new ForbiddenException(
          `Your account has been suspended. Reason: ${reason}.${expiry}`,
        )
      }

      const passwordOk = await bcrypt.compare(dto.password, user.passwordHash)
      if (!passwordOk) {
        throw new UnauthorizedException('Invalid email or password.')
      }

      if (user.scoreRestrictedUntil && new Date() < user.scoreRestrictedUntil) {
        const until = user.scoreRestrictedUntil.toLocaleDateString()
        throw new ForbiddenException(
          `Your account is restricted until ${until} due to a low reliability score.`,
        )
      }

      const normalizedEmail = user.email.toLowerCase().trim()
      const otp = this.otpService.generate()
      await this.otpService.storeEmailOtp(`login:${normalizedEmail}`, otp)

      const sent = await this.resendService.sendOtp(normalizedEmail, otp)
      if (!sent) {
        this.logger.error(`Login 2FA OTP email failed for ${normalizedEmail}`)
        throw new InternalServerErrorException(
          'Could not send verification email. Please try again.',
        )
      }
      this.logger.log(`Login 2FA OTP sent to ${normalizedEmail}`)
      if (this.otpService.isTestEmail(normalizedEmail)) {
        this.logger.warn(
          `[TEST] Bypass code still accepted for ${normalizedEmail}`,
        )
      }

      return { message: '2FA OTP sent. Please verify to complete login.' }
    } catch (err) {
      if (err instanceof UnauthorizedException || err instanceof ForbiddenException) throw err
      if (err instanceof InternalServerErrorException) throw err

      this.logger.error('login failed:', err)
      throw new InternalServerErrorException('Login failed. Please try again.')
    }
  }

  // ── Login: resend 2FA OTP (no password re-entry) ─
  async resendLoginOtp(email: string): Promise<{ message: string }> {
    try {
      const normalizedEmail = email.toLowerCase().trim()
      const user = await this.userModel.findOne({ email: normalizedEmail })

      if (!user) {
        // Same message as success — avoid account enumeration
        return { message: '2FA OTP sent. Please verify to complete login.' }
      }

      if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }

      if (user.isBanned) {
        throw new ForbiddenException('Your account has been suspended.')
      }

      const otp = this.otpService.generate()
      await this.otpService.storeEmailOtp(`login:${normalizedEmail}`, otp)

      const sent = await this.resendService.sendOtp(normalizedEmail, otp)
      if (!sent) {
        this.logger.error(`Resend login OTP email failed for ${normalizedEmail}`)
        throw new InternalServerErrorException(
          'Could not send verification email. Please try again.',
        )
      }

      this.logger.log(`Login 2FA OTP resent to ${normalizedEmail}`)
      return { message: '2FA OTP sent. Please verify to complete login.' }
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof InternalServerErrorException) {
        throw err
      }
      this.logger.error('resendLoginOtp failed:', err)
      throw new InternalServerErrorException('Could not resend code. Please try again.')
    }
  }

  // ── Login (step 2: verify OTP → issue tokens) ─
  async verifyLoginOtp(email: string, otp: string) {
    try {
      const normalizedEmail = email.toLowerCase().trim()
      const user = await this.userModel.findOne({ email: normalizedEmail })
      if (!user) {
        throw new BadRequestException('Invalid request')
      }

      if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'Sellers cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }

      const allowed = await this.otpService.checkAndIncrementAttempts(
        `login:${normalizedEmail}`,
      )
      if (!allowed) {
        throw new ForbiddenException('Too many attempts. Please request a new code.')
      }

      const valid = await this.otpService.verifyEmailOtp(
        `login:${normalizedEmail}`,
        otp,
      )
      if (!valid) {
        throw new UnauthorizedException('Incorrect verification code.')
      }

      await this.otpService.clearAttempts(`login:${normalizedEmail}`)
      return this.createSession(user)
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException ||
        err instanceof BadRequestException
      ) {
        throw err
      }
      this.logger.error('verifyLoginOtp failed:', err)
      throw new InternalServerErrorException('OTP verification failed. Please try again.')
    }
  }

  // ── Refresh token ─────────────────────────────
  async refresh(rawRefreshToken: string): Promise<{
    accessToken: string
    refreshToken: string
    user: ReturnType<AuthService['sanitizeUser']>
  }> {
    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string
        sessionId: string
      }>(rawRefreshToken, {
        secret: this.configService.getOrThrow<string>('jwt.refreshSecret'),
      })

      const session = await this.sessionModel.findOne({
        sessionId: payload.sessionId,
      })
      if (!session) {
        throw new UnauthorizedException('Session revoked')
      }

      const hashMatch = await bcrypt.compare(
        rawRefreshToken,
        session.refreshTokenHash,
      )
      if (!hashMatch) {
        throw new UnauthorizedException('Invalid refresh token')
      }

      if (session.isBlacklisted) {
        const rotatedAt = session.blacklistedAt?.getTime?.()
          ? session.blacklistedAt.getTime()
          : 0
        // Only concurrent rotation (has rotatedTo) is retryable — not explicit logout.
        if (
          session.rotatedTo &&
          rotatedAt &&
          Date.now() - rotatedAt < REFRESH_ROTATION_GRACE_MS
        ) {
          throw new UnauthorizedException({
            message:
              'Refresh token was rotated by a concurrent request. Retry shortly.',
            code: 'TOKEN_ROTATED',
          })
        }
        throw new UnauthorizedException('Session revoked')
      }

      const user = await this.userModel.findById(payload.sub)
      if (!user) throw new UnauthorizedException('User not found')
      if (!APP2_ALLOWED_ROLES.includes(user.role as UserRole)) {
        throw new ForbiddenException(
          'This account cannot access the Marketplace. Please sign in at the Acquisition platform.',
        )
      }

      return this.createSession(user, { rotatingFrom: session })
    } catch (err) {
      if (
        err instanceof UnauthorizedException ||
        err instanceof ForbiddenException
      ) {
        throw err
      }

      this.logger.error('refresh failed:', err)
      throw new UnauthorizedException('Session expired. Please log in.')
    }
  }

  // ── Refresh from cookie ───────────────────────
  async refreshFromCookie(rawRefresh: string) {
    return this.refresh(rawRefresh)
  }

  // ── Logout ────────────────────────────────────
  async logout(userId: string, sessionId?: string): Promise<void> {
    try {
      if (sessionId) {
        await this.sessionModel.updateOne(
          { sessionId },
          {
            isBlacklisted: true,
            blacklistedAt: new Date(),
            rotatedTo: null,
          },
        )
      } else {
        await this.sessionModel.updateMany(
          { userId, isBlacklisted: false },
          {
            isBlacklisted: true,
            blacklistedAt: new Date(),
            rotatedTo: null,
          },
        )
      }
      await this.userModel.findByIdAndUpdate(userId, {
        currentSessionId: null,
        refreshToken: null,
      })
      this.logger.log(`User ${userId} logged out`)
    } catch (err) {
      this.logger.error(`logout failed for ${userId}:`, err)
    }
  }

  // ── Get me ────────────────────────────────────
  async getMe(userId: string) {
    try {
      const user = await this.userModel.findById(userId)
      if (!user) throw new UnauthorizedException('User not found.')

      // Until Jumio is live (KYC_REQUIRED=true), keep accounts auto-approved.
      if (process.env.KYC_REQUIRED !== 'true' && user.kycStatus !== KycStatus.APPROVED) {
        user.kycStatus = KycStatus.APPROVED
        user.kycVerifiedAt = user.kycVerifiedAt ?? new Date()
        user.kycProvider = user.kycProvider || 'auto'
        await user.save()
      }

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
    const user = await this.userModel.findById(userId).select('+passwordHash').exec()
    if (!user) {
      throw new NotFoundException('User not found.')
    }

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect.')
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS)
    user.refreshToken = null
    user.currentSessionId = null
    await user.save()

    await this.sessionModel.updateMany(
      { userId, isBlacklisted: false },
      {
        isBlacklisted: true,
        blacklistedAt: new Date(),
        rotatedTo: null,
      },
    )

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

      const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
      await this.userModel.findByIdAndUpdate(user._id, {
        passwordHash: hashed,
        refreshToken: null,
        currentSessionId: null,
      })

      await this.sessionModel.updateMany(
        { userId: user._id, isBlacklisted: false },
        {
          isBlacklisted: true,
          blacklistedAt: new Date(),
          rotatedTo: null,
        },
      )

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
    if (existing.kycStatus === KycStatus.APPROVED) {
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

      await this.userModel.findByIdAndUpdate(userId, {
        kycStatus: KycStatus.IN_PROGRESS,
      })

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

      const kycStatus =
        verificationStatus === 'APPROVED_VERIFIED'
          ? KycStatus.APPROVED
          : KycStatus.REJECTED

      const updated = await this.userModel
        .findByIdAndUpdate(customerId, {
          $set: {
            kycStatus,
            kycVerifiedAt: kycStatus === KycStatus.APPROVED ? new Date() : null,
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
