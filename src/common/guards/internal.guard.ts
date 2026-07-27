import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Request } from 'express'

@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const provided = request.header('x-internal-key')
    const expected = process.env.INTERNAL_SERVICE_KEY

    if (!expected || !provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing internal service key')
    }

    return true
  }
}
