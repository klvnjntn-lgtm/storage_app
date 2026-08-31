// src/auth/guards/admin-key.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { secureCompare } from '../utils/secure-compare';

@Injectable()
export class AdminKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-superadmin-secret'];
    const expected = process.env.SUPERADMIN_SECRET;

    if (!key || typeof key !== 'string' || !expected || !secureCompare(key, expected)) {
      throw new ForbiddenException('Invalid or missing superadmin secret');
    }
    return true;
  }
}