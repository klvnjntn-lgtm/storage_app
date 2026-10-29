// src/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('MASTER' | 'ADMIN' | 'USER' | 'DRIVER' | 'MECHANIC')[]) => SetMetadata(ROLES_KEY, roles);