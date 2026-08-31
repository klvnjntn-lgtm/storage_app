// src/auth/guards/module.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleKey } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_MODULE_KEY } from '../decorators/require-module.decorator';

// Modules that depend on another module being active first.
// WORKSHOP_RMS requires INVOICE_POS — checked both at grant time
// (organization-modules.service.ts) and here at request time, since
// INVOICE_POS could expire/be disabled after WORKSHOP_RMS was granted.
//
// This dependency check only fires when a route is gated behind
// WORKSHOP_RMS specifically as a single-module requirement
// (@RequireModule(ModuleKey.WORKSHOP_RMS)). It's intentionally skipped
// for multi-module "any of" gates like
// @RequireModule(INVOICE_POS, WORKSHOP_RMS) — there the route is meant
// to work for either plan, and enforcing WORKSHOP_RMS's dependency
// inside an OR list would incorrectly reject an INVOICE_POS-only org
// that never touched WORKSHOP_RMS at all.
const MODULE_DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey>> = {
  [ModuleKey.WORKSHOP_RMS]: ModuleKey.INVOICE_POS,
};

// Runs AFTER OrgGuard (class-level guards execute before method-level
// ones in Nest), so request.organizationId is already set and verified
// to exist in the DB by the time this guard runs.
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModules = this.reflector.getAllAndOverride<ModuleKey[]>(
      REQUIRE_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredModules || requiredModules.length === 0) {
      return true; // route isn't gated
    }

    const request = context.switchToHttp().getRequest();
    const organizationId: string | undefined =
      request.organizationId ?? request.user?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException('No organization context on request');
    }

    const active = await this.anyModuleActive(organizationId, requiredModules);
    if (!active) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'ModuleNotEnabled',
        requiresAnyOf: requiredModules,
        message:
          requiredModules.length === 1
            ? `Your organization does not have the ${requiredModules[0]} module enabled`
            : `Your organization needs one of: ${requiredModules.join(', ')}`,
      });
    }

    // Dependency check only applies to a single-module gate — see
    // comment on MODULE_DEPENDENCIES above for why it's skipped on
    // multi-module "any of" gates.
    if (requiredModules.length === 1) {
      const [requiredModule] = requiredModules;
      const dependsOn = MODULE_DEPENDENCIES[requiredModule];
      if (dependsOn) {
        const dependencyActive = await this.isActive(organizationId, dependsOn);
        if (!dependencyActive) {
          throw new ForbiddenException({
            statusCode: 403,
            error: 'ModuleDependencyNotMet',
            module: requiredModule,
            requires: dependsOn,
            message: `${requiredModule} requires ${dependsOn} to be active`,
          });
        }
      }
    }

    return true;
  }

  private async isActive(organizationId: string, module: ModuleKey): Promise<boolean> {
    const entitlement = await this.prisma.organizationModule.findUnique({
      where: {
        organizationId_module: { organizationId, module },
      },
    });
    return !!(
      entitlement?.enabled &&
      (!entitlement.expiresAt || entitlement.expiresAt > new Date())
    );
  }

  private async anyModuleActive(organizationId: string, modules: ModuleKey[]): Promise<boolean> {
    for (const module of modules) {
      if (await this.isActive(organizationId, module)) return true;
    }
    return false;
  }
}