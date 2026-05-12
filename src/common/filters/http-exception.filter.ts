import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common'
import { Request, Response } from 'express'

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request  = ctx.getRequest<Request>()

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error'

    this.logger.error(
      `${request.method} ${request.url} → ${status}`,
      exception instanceof Error ? exception.stack : String(exception),
    )

    response.status(status).json({
      success:   false,
      statusCode: status,
      message:
        typeof message === 'object' && 'message' in (message as object)
          ? (message as { message: string | string[] }).message
          : message,
      path:      request.url,
      timestamp: new Date().toISOString(),
    })
  }
}
