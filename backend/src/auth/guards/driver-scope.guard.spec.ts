import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DriverScopeGuard } from './driver-scope.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

function ctx(role: string | undefined, meta: Record<string, unknown>) {
  const handler = () => undefined;
  Object.entries(meta).forEach(([k, v]) =>
    Reflect.defineMetadata(k, v, handler),
  );
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ user: role ? { role } : undefined }),
    }),
  } as any;
}

describe('DriverScopeGuard', () => {
  const guard = new DriverScopeGuard(new Reflector());

  it('lets non-drivers through regardless of @Roles', () => {
    expect(guard.canActivate(ctx('USER', {}))).toBe(true);
    expect(guard.canActivate(ctx('ADMIN', { [ROLES_KEY]: ['ADMIN'] }))).toBe(
      true,
    );
  });

  it('blocks a driver on routes without @Roles or without DRIVER in it', () => {
    expect(() => guard.canActivate(ctx('DRIVER', {}))).toThrow(
      ForbiddenException,
    );
    expect(() =>
      guard.canActivate(ctx('DRIVER', { [ROLES_KEY]: ['ADMIN', 'USER'] })),
    ).toThrow(ForbiddenException);
  });

  it('lets a driver through where @Roles names DRIVER, and on public routes', () => {
    expect(
      guard.canActivate(ctx('DRIVER', { [ROLES_KEY]: ['ADMIN', 'DRIVER'] })),
    ).toBe(true);
    expect(guard.canActivate(ctx('DRIVER', { [IS_PUBLIC_KEY]: true }))).toBe(
      true,
    );
  });

  // The shop PC's mechanic account is held the same way: only its own board.
  it('holds the mechanic account to routes naming MECHANIC', () => {
    expect(() => guard.canActivate(ctx('MECHANIC', {}))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('MECHANIC', { [ROLES_KEY]: ['ADMIN', 'USER'] }))).toThrow(ForbiddenException);
    // A driver route isn't the mechanic's, nor the other way round.
    expect(() => guard.canActivate(ctx('MECHANIC', { [ROLES_KEY]: ['DRIVER'] }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(ctx('DRIVER', { [ROLES_KEY]: ['MECHANIC'] }))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx('MECHANIC', { [ROLES_KEY]: ['ADMIN', 'USER', 'MECHANIC'] }))).toBe(true);
  });
});
