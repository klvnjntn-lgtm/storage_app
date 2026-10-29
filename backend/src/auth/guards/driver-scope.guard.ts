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

// Global deny-by-default for the single-purpose accounts: DRIVER (the
// driver page) and MECHANIC (the shop PC's mechanic board). RolesGuard
// treats "no @Roles()" as "any authenticated user", which let such a token
// reach every un-annotated endpoint (products, stock, invoices…). Here one
// gets through only where @Roles(...) explicitly names its role — its own
// page's endpoints. Other roles are unaffected; RolesGuard still does the
// normal per-route role check.
const SCOPED_ROLES = ['DRIVER', 'MECHANIC'];
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
    const role = user?.role;
    if (!role || !SCOPED_ROLES.includes(role)) return true;

    const roles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      targets,
    );
    if (roles?.includes(role)) return true;

    throw new ForbiddenException(
      role === 'DRIVER' ? 'Not available to driver accounts' : 'Not available to the mechanic account',
    );
  }
}
