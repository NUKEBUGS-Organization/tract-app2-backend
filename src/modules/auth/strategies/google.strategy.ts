import { Injectable } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { ConfigService } from '@nestjs/config'
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20'

export interface GoogleProfile {
  googleId: string
  email: string
  fullName: string
  avatarUrl: string | null
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('google.clientId') ?? 'not-configured',
      clientSecret: config.get<string>('google.clientSecret') ?? 'not-configured',
      callbackURL: config.get<string>('google.callbackUrl') ?? '',
      scope: ['email', 'profile'],
    })
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0]?.value
    if (!email) {
      done(new Error('Google account has no email address.'), undefined)
      return
    }
    const googleProfile: GoogleProfile = {
      googleId: profile.id,
      email,
      fullName: profile.displayName || email,
      avatarUrl: profile.photos?.[0]?.value ?? null,
    }
    done(null, googleProfile)
  }
}
