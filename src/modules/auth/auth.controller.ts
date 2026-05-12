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
import { Public } from '../../common/decorators/public.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { AuthService } from './auth.service'
import { LoginDto } from './dto/login.dto'
import { RegisterDto } from './dto/register.dto'
import { VerifyOtpDto } from './dto/verify-otp.dto'
import { SendOtpDto } from './dto/send-otp.dto'

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  async sendOtp(@Body() body: SendOtpDto) {
    await this.authService.sendOtp(body.phone, body.email)
    return { message: 'Verification codes sent.' }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    await this.authService.verifyOtp(dto.phone, dto.email, dto.smsOtp, dto.emailOtp)
    return { message: 'Codes verified successfully.' }
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto)
    res.cookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS)
    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
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
  async refresh(@Req() req: Request) {
    const token = req.cookies?.refreshToken as string | undefined
    if (!token) {
      throw new UnauthorizedException('Session expired. Please log in.')
    }
    return this.authService.refreshFromCookie(token)
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@CurrentUser() user: { _id: { toString(): string } }, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(user._id.toString())
    res.clearCookie('refreshToken', { path: '/' })
    return { message: 'Logged out.' }
  }

  @Get('me')
  async getMe(@CurrentUser() user: { _id: { toString(): string } }) {
    return this.authService.getMe(user._id.toString())
  }
}
