import { Controller, Get, Head, HttpCode, HttpStatus } from '@nestjs/common'
import { ApiExcludeController } from '@nestjs/swagger'
import { Public } from './common/decorators/public.decorator'

@ApiExcludeController()
@Controller()
export class AppController {
  @Public()
  @Get()
  root() {
    return {
      ok:      true,
      service: 'tract-app2-backend',
      docs:    '/api/docs',
    }
  }

  @Public()
  @Head()
  @HttpCode(HttpStatus.NO_CONTENT)
  rootHead() {
    // no body
  }
}
