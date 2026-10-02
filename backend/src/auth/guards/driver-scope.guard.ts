// src/auth/guards/driver-scope.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Global deny-by-default for DRIVER accounts. RolesGuard treats "no
// @Roles()" as "any authenticated user", which let a driver token reach
// every un-annotated endpoint (products, stock, invoices…). Here a DRIVER
// gets through only where @Roles(...) explicitly names 'DRIVER' — the
// driver page's own endpoints. Other roles are unaffected; RolesGuard
// still does the normal per-route role check.
@Injectable()
export class DriverScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const { user } = context
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    if (user?.role !== 'DRIVER') return true;

    const roles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      targets,
    );
    if (roles?.includes('DRIVER')) return true;

    throw new ForbiddenException('Not available to driver accounts');
  }
}
