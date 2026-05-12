import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole }  from '../enums/user-role.enum'
import { ROLES_KEY } from '../decorators/roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() === 'ws') return true
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (!requiredRoles?.length) return true

    const { user } = context.switchToHttp().getRequest()
    return requiredRoles.includes(user?.role)
  }
}
