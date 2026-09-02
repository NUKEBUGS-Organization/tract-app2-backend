import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    let status = HttpStatus.INTERNAL_SERVER_ERROR
    let message: string = 'Internal server error'
    let details: unknown = null
    let code: string | undefined

    if (exception instanceof HttpException) {
      status = exception.getStatus()
      const body = exception.getResponse()
      if (typeof body === 'string') {
        message = body
      } else {
        const b = body as {
          message?: string | string[]
          details?: unknown
          code?: string
        }
        const m = b.message
        message = Array.isArray(m)
          ? m.join(', ')
          : typeof m === 'string'
            ? m
            : message
        details = b.details ?? null
        code = typeof b.code === 'string' ? b.code : undefined
      }
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      ((exception as { name?: string }).name === 'PayloadTooLargeError' ||
        (exception as { type?: string }).type === 'entity.too.large' ||
        /entity too large|payload too large/i.test(
          String((exception as { message?: string }).message ?? ''),
        ))
    ) {
      status = HttpStatus.PAYLOAD_TOO_LARGE
      message = 'Request body too large'
    } else if (exception instanceof Error) {
      if (exception instanceof SyntaxError && /json/i.test(exception.message)) {
        status = HttpStatus.BAD_REQUEST
        message = 'Invalid JSON body'
      } else {
        message = exception.message
        this.logger.error(
          `Unhandled error on ${request.method} ${request.url}:`,
          exception.stack,
        )
      }
    } else {
      this.logger.error(
        `Unknown error on ${request.method} ${request.url}:`,
        exception,
      )
    }

    if (status >= 500) {
      this.logger.error(
        `${status} ${request.method} ${request.url} — ${message}`,
      )
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      ...(code ? { code } : {}),
      details,
      data: null,
      timestamp: new Date().toISOString(),
      path: request.url,
    })
  }
}
