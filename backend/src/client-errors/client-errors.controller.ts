// src/client-errors/client-errors.controller.ts
import { Body, Controller, Headers, HttpCode, Logger, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { SkipLicenseCheck } from '../license/decorators/skip-license-check.decorator';
import { ClientErrorDto } from './client-error.dto';

// Where browsers report what only they can see: a page whose code didn't
// load, or a crash on the error screen. To the log only, nothing stored.
// Public, because the login page can fail too; so everything from it is
// treated as untrusted text and kept to one short line.
@Public()
@SkipLicenseCheck()
@Controller('client-errors')
export class ClientErrorsController {
  private readonly logger = new Logger('ClientError');

  @Post()
  @HttpCode(204)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  report(@Body() dto: ClientErrorDto, @Headers('user-agent') userAgent?: string) {
    const flat = (v?: string, max = 500) => v?.replace(/[\r\n\t]+/g, ' ').slice(0, max);
    this.logger.warn(
      `kind=${flat(dto.kind)}` +
        (dto.page ? ` page=${flat(dto.page)}` : '') +
        (dto.digest ? ` digest=${flat(dto.digest)}` : '') +
        (dto.message ? ` message="${flat(dto.message)}"` : '') +
        ` ua="${flat(userAgent, 160) ?? ''}"`,
    );
  }
}
