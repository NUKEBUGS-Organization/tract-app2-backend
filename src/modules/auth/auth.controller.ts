import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common'
import type { Request, Response } from 'express'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import { Public } from '../../common/decorators/public.decorator'
import { APP2_STATES } from '../../common/constants/states.constants'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { SendOtpDto } from './dto/send-otp.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'
import { ResendLoginOtpDto } from './dto/resend-login-otp.dto'

const isProd = process.env.NODE_ENV === 'production'

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
  ...(isProd ? { domain: '.tractcorp.com' } : {}),
}

const CLEAR_REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
  ...(isProd ? { domain: '.tractcorp.com' } : {}),
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('states')
  @ApiOperation({
    summary: 'Get supported US states for App 2',
  })
  getStates() {
    return APP2_STATES
  }

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP code to email' })
  @ApiResponse({ status: 200, description: 'OTP code sent' })
  async sendOtp(@Body() body: SendOtpDto) {
    await this.authService.sendOtp(body.email)
    return { message: 'Verification code sent.' }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify email OTP code' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.authService.verifyOtp(dto.email, dto.emailOtp)
    return { message: 'Code verified successfully.' }
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register new user after OTP verification' })
  @ApiResponse({ status: 201, description: 'User registered' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto)
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS)
    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset code via email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email)
    return {
      message: 'If an account exists, a reset code has been sent.',
    }
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with email code' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.email, dto.token, dto.newPassword)
    return { message: 'Password reset successfully.' }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email and password — sends 2FA OTP',
  })
  @ApiResponse({ status: 200, description: '2FA OTP sent' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto)
  }

  @Public()
  @Post('resend-login-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend login 2FA OTP to email' })
  @ApiResponse({ status: 200, description: '2FA OTP resent' })
  async resendLoginOtp(@Body() dto: ResendLoginOtpDto) {
    return this.authService.resendLoginOtp(dto.email)
  }

  @Public()
  @Post('verify-login-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify login 2FA OTP and issue tokens' })
  async verifyLoginOtp(
    @Body() dto: VerifyLoginOtpDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyLoginOtp(dto.email, dto.otp)
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS)
    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token using httpOnly cookie' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.refreshToken as string | undefined
    if (!token) {
      throw new UnauthorizedException('Session expired. Please log in.')
    }
    const result = await this.authService.refreshFromCookie(token)
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS)
    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Change password' })
  async changePassword(
    @CurrentUser() user: { _id: { toString(): string } },
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(user._id.toString(), dto)
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout and clear refresh token' })
  async logout(
    @CurrentUser() user: { _id: { toString(): string }; sessionId?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user._id.toString(), user.sessionId)
    res.clearCookie('refreshToken', CLEAR_REFRESH_COOKIE_OPTIONS)
    return { message: 'Logged out.' }
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getMe(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.authService.getMe(user._id.toString())
  }

  @Post('kyc/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Generate Jumio session for ID + face verification',
    description:
      'Returns **kyc_access_token** for the Jumio Web SDK (same pattern as tract-app1-backend). ' +
      'Set **JUMIO_CALLBACK_URL** or **API_PUBLIC_URL** so `callbackUrl` can be sent to Jumio.',
  })
  initiateKyc(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.authService.initiateKyc(user._id.toString())
  }

  @Public()
  @Post('kyc/webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'KYC status callback (minimal contract)',
    description:
      'Maps verificationStatus APPROVED_VERIFIED → approved; otherwise rejected.',
  })
  @ApiResponse({ status: 200 })
  kycWebhook(@Body() payload: Record<string, unknown>) {
    return this.authService.handleKycWebhook(payload)
  }
}
