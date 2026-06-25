import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the organizationId from the JWT payload attached to the request.
 *
 * Usage:
 *   someMethod(@CurrentOrg() orgId: string) { ... }
 */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.user?.organizationId;
  },
);