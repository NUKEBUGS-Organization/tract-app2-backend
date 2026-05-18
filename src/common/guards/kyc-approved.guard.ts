import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import { REQUIRE_KYC_APPROVED_KEY } from '../decorators/require-kyc-approved.decorator'
import { UserRole } from '../enums/user-role.enum'

@Injectable()
export class KycApprovedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() === 'ws') return true

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const requireKyc = this.reflector.getAllAndOverride<boolean>(REQUIRE_KYC_APPROVED_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!requireKyc) return true

    const req = context.switchToHttp().getRequest()
    const user = req.user as { role?: string; kycStatus?: string } | undefined
    if (!user) return false

    if (user.role === UserRole.ADMIN) return true
    if (user.kycStatus === 'approved') return true

    throw new ForbiddenException(
      'Approve identity verification (KYC) to perform this action. Complete verification under Profile → Verify identity.',
    )
  }
}
