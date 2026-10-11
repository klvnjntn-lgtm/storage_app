// src/auth/decorators/allow-suspended-org.decorator.ts
import { SetMetadata } from '@nestjs/common';

// OrgGuard rejects every request from a suspended organization's members.
// Mark the few routes the app still needs to explain that to them (e.g.
// GET /auth/me). Never put this on a route that reads or writes org data.
export const ALLOW_SUSPENDED_ORG_KEY = 'allowSuspendedOrg';
export const AllowSuspendedOrg = () =>
  SetMetadata(ALLOW_SUSPENDED_ORG_KEY, true);
