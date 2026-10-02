import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { APP_GUARD } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';
import { RolesGuard } from './roles.guard';
import { ModuleGuard } from './module.guard';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OrgGuard } from './org.guard';
import { DriverScopeGuard } from './driver-scope.guard';

process.env.PRINT_TOKEN_SECRET ??= 'test-print-secret';
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// @Roles and @RequireModule are only metadata — they do nothing unless
// RolesGuard / ModuleGuard runs. Both used to be opt-in per controller, and
// a missing @UseGuards silently left routes unprotected. They are now
// global (app.module.ts); these tests keep it that way and catch routes
// whose decorators contradict each other.

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

type Route = { name: string; handler: object; cls: object };

function allRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(join(__dirname, '..', '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function' || Reflect.getMetadata(PATH_METADATA, exported) === undefined) continue;
      const proto = (exported as { prototype: Record<string, unknown> }).prototype;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (key === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        routes.push({ name: `${(exported as { name: string }).name}.${key}`, handler, cls: exported });
      }
    }
  }
  return routes;
}

const meta = <T>(key: string, r: Route): T | undefined =>
  (Reflect.getMetadata(key, r.handler) ?? Reflect.getMetadata(key, r.cls)) as T | undefined;

describe('guard coverage', () => {
  const routes = allRoutes();

  it('finds the controllers', () => {
    expect(routes.length).toBeGreaterThan(100);
  });

  it('registers the auth guards globally, in order', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../app.module') as { AppModule: object };
    const providers: { provide?: unknown; useClass?: unknown }[] =
      Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AppModule) ?? [];
    const order = providers.filter((p) => p.provide === APP_GUARD).map((p) => p.useClass);
    const at = (g: unknown) => order.indexOf(g);
    for (const g of [JwtAuthGuard, OrgGuard, DriverScopeGuard, RolesGuard, ModuleGuard]) {
      expect(at(g)).toBeGreaterThanOrEqual(0);
    }
    expect(at(JwtAuthGuard)).toBeLessThan(at(OrgGuard));
    expect(at(OrgGuard)).toBeLessThan(at(RolesGuard));
    expect(at(OrgGuard)).toBeLessThan(at(ModuleGuard));
  });

  it('registers every controller in the module graph', () => {
    // A controller that no module lists simply doesn't exist at runtime —
    // SalesOrderPrintController went unregistered and its route 404'd.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../../app.module') as { AppModule: object };
    const registered = new Set<unknown>();
    const seen = new Set<unknown>();
    const walk = (mod: unknown) => {
      const m = (mod as { module?: unknown })?.module ?? mod; // dynamic modules
      if (!m || seen.has(m)) return;
      seen.add(m);
      for (const c of (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) ?? []) as unknown[]) registered.add(c);
      for (const i of (Reflect.getMetadata(MODULE_METADATA.IMPORTS, m) ?? []) as unknown[]) walk(i);
    };
    walk(AppModule);
    // Known, deliberate exception: GoodsReceiptModule (receiving against a
    // purchase order) is built but not imported into AppModule and has no
    // UI yet. Remove it from this list when it is wired up.
    const NOT_YET_WIRED = ['GoodsReceiptController'];
    const missing = [...new Set(routes.map((r) => r.cls))]
      .filter((c) => !registered.has(c))
      .map((c) => (c as { name: string }).name)
      .filter((name) => !NOT_YET_WIRED.includes(name));
    expect(missing).toEqual([]);
  });

  it('keeps finance, destructive and configuration routes admin-only', () => {
    // Decided gating for the USER role. Whole controllers: the books, money
    // going out. Single routes: deleting master data, bulk import, team and
    // driver assignment, integration setup.
    const ADMIN_CONTROLLERS = ['AccountingController', 'ExpensesController', 'FixedAssetsController', 'SupplierPaymentsController', 'PayrollController'];
    const ADMIN_ROUTES = [
      'CustomersController.remove',
      'CustomersController.importMany',
      'SupplierController.delete',
      'SupplierController.deactivate',
      'VehiclesController.remove',
      'MediaController.remove',
      'TeamsController.create',
      'TeamsController.rename',
      'TeamsController.remove',
      'TeamsController.assignDriver',
      'TeamsController.unassignDriver',
      'IntegrationController.createConnection',
    ];
    // Deliberately open to staff inside an admin-only controller.
    const EXCEPTIONS = ['AccountingController.listPeriods'];

    const notAdminOnly = routes
      .filter((r) => {
        const cls = (r.cls as { name: string }).name;
        return (ADMIN_CONTROLLERS.includes(cls) || ADMIN_ROUTES.includes(r.name)) && !EXCEPTIONS.includes(r.name);
      })
      .filter((r) => JSON.stringify(meta<string[]>(ROLES_KEY, r)) !== JSON.stringify(['ADMIN']))
      .map((r) => r.name);
    expect(notAdminOnly).toEqual([]);
    // Every listed route must exist, so a rename can't silently drop it.
    for (const name of ADMIN_ROUTES) expect(routes.map((r) => r.name)).toContain(name);
  });

  it('never combines @Public with @Roles or @RequireModule', () => {
    // A public route has no user, so a role or module check on it would
    // always fail — the two decorators contradict each other.
    const conflicts = routes
      .filter((r) => meta<boolean>(IS_PUBLIC_KEY, r))
      .filter((r) => meta<string[]>(ROLES_KEY, r)?.length || meta<string[]>(REQUIRE_MODULE_KEY, r)?.length)
      .map((r) => r.name);
    expect(conflicts).toEqual([]);
  });

  it('can read per-route guard metadata', () => {
    // Keeps this file honest: if a refactor changed how guards are attached
    // and GUARDS_METADATA stopped resolving, the checks above would still
    // pass while checking nothing.
    const withGuards = routes.filter((r) => meta<unknown[]>(GUARDS_METADATA, r)?.length);
    expect(withGuards.length).toBeGreaterThan(0);
  });
});
