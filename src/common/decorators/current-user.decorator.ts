import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/** Populated by JwtStrategy after Bearer access token validation */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest()
  return request.user as Record<string, unknown> | undefined
})
