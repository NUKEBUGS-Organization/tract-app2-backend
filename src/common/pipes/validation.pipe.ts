import { Injectable, PipeTransform } from '@nestjs/common'

/** Placeholder — global ValidationPipe is configured in main.ts */
@Injectable()
export class AppValidationPipe implements PipeTransform {
  transform(value: unknown) {
    return value
  }
}
