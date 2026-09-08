import {
  Injectable, NestInterceptor,
  ExecutionContext, CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map }        from 'rxjs/operators'
import { responseForViewer } from '../utils/buyer-response'

export interface ApiResponse<T> {
  success: boolean
  data:    T
  message?: string
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const user = context.switchToHttp().getRequest<{ user?: { role?: string; _id?: unknown } }>().user
        return responseForViewer(data, user?.role, user?._id?.toString())
      }),
      map((data: T & { data?: T; message?: string }) => ({
        success: true,
        data:    data && typeof data === 'object' && 'data' in data
          ? (data as { data: T }).data
          : data,
        message:
          data && typeof data === 'object' && 'message' in data
            ? (data as { message?: string }).message
            : undefined,
      })),
    )
  }
}
