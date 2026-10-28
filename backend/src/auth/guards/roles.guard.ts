// src/auth/guards/roles.guard.ts
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true; // no @Roles() means any authenticated user is fine
    }

    const { user } = context.switchToHttp().getRequest();
    // MASTER outranks ADMIN: anything an admin may do, it may too.
    if (user?.role === 'MASTER' && requiredRoles.includes('ADMIN')) return true;
    return requiredRoles.includes(user?.role);
  }
}