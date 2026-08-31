// src/auth/decorators/current-org.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    // Prefer the DB-verified value OrgGuard sets. Falls back to the
    // raw JWT claim only if OrgGuard didn't run on this route (e.g.
    // a @Public() route reading org context in a custom way) — in
    // that case the value is unverified.
    return request.organizationId ?? request.user?.organizationId;
  },
);