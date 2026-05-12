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
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { SendOtpDto } from './dto/send-otp.dto'
import { ForgotPasswordDto } from './dto/forgot-password.dto'
import { ResetPasswordDto } from './dto/reset-password.dto'

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send OTP codes to phone and email' })
  @ApiResponse({ status: 200, description: 'OTP codes sent' })
  async sendOtp(@Body() body: SendOtpDto) {
    await this.authService.sendOtp(body.phone, body.email)
    return { message: 'Verification codes sent.' }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify SMS and email OTP codes' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.authService.verifyOtp(dto.phone, dto.email, dto.smsOtp, dto.emailOtp)
    return { message: 'Codes verified successfully.' }
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
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'JWT token returned' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto)
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
  async refresh(@Req() req: Request) {
    const token = req.cookies?.refreshToken as string | undefined
    if (!token) {
      throw new UnauthorizedException('Session expired. Please log in.')
    }
    return this.authService.refreshFromCookie(token)
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Logout and clear refresh token' })
  async logout(@CurrentUser() user: { _id: { toString(): string } }, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user._id.toString())
    res.clearCookie('refreshToken', { path: '/' })
    return { message: 'Logged out.' }
  }

  @Get('me')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current authenticated user' })
  async getMe(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.authService.getMe(user._id.toString())
  }
}
