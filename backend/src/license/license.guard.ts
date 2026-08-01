import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseService } from './license.service';
import { SKIP_LICENSE_CHECK } from './decorators/skip-license-check.decorator';

@Injectable()
export class LicenseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licenseService: LicenseService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
  const skip = this.reflector.getAllAndOverride<boolean>(
    SKIP_LICENSE_CHECK,
    [context.getHandler(), context.getClass()],
  );

  console.log('🔍 LicenseGuard running. skip:', skip, 'isValid:', this.licenseService.isValid());

  if (skip) return true;

  if (!this.licenseService.isValid()) {
    throw new ForbiddenException({
      code: 'LICENSE_INVALID',
      message: 'License invalid or expired. Contact support to renew.',
    });
  }

  return true;
}
}