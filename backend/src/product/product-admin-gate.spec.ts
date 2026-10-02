import { Reflector } from '@nestjs/core';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { ProductController } from './product.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

// Every product write is admin-only; reads stay open. Checks the route
// metadata itself, so a new write endpoint added without the guard fails.
describe('ProductController admin gate', () => {
  const reflector = new Reflector();
  const proto = ProductController.prototype as unknown as Record<string, () => unknown>;
  const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
  const WRITE = [RequestMethod.POST, RequestMethod.PATCH, RequestMethod.PUT, RequestMethod.DELETE];

  it.each(handlers)('%s', (name) => {
    const method = Reflect.getMetadata(METHOD_METADATA, proto[name]);
    if (method === undefined) return; // not a route
    const roles = reflector.get<string[]>(ROLES_KEY, proto[name]);
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? [];
    if (WRITE.includes(method)) {
      expect(roles).toEqual(['ADMIN']);
      expect(guards).toContain(RolesGuard);
    } else {
      expect(roles).toBeUndefined();
    }
  });

  it('guard rejects non-admins and allows admins', () => {
    const guard = new RolesGuard(reflector);
    const ctx = (role: string) =>
      ({
        getHandler: () => proto.create,
        getClass: () => ProductController,
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
      }) as never;
    expect(guard.canActivate(ctx('USER'))).toBe(false);
    expect(guard.canActivate(ctx('DRIVER'))).toBe(false);
    expect(guard.canActivate(ctx('ADMIN'))).toBe(true);
  });
});
