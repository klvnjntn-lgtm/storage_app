// src/auth/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: ('ADMIN' | 'USER' | 'DRIVER')[]) => SetMetadata(ROLES_KEY, roles);