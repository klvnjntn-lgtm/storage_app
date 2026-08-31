// src/organization-modules/organization-modules.service.ts
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ModuleKey } from '@prisma/client';

const MODULE_DEPENDENCIES: Partial<Record<ModuleKey, ModuleKey>> = {
  [ModuleKey.WORKSHOP_RMS]: ModuleKey.INVOICE_POS,
};

@Injectable()
export class OrganizationModulesService {
  constructor(private prisma: PrismaService) {}

  private async assertOrgExists(organizationId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException(`Organization ${organizationId} not found`);
    }
  }

  async getEnabledModules(organizationId: string): Promise<ModuleKey[]> {
    const rows = await this.prisma.organizationModule.findMany({
      where: {
        organizationId,
        enabled: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { module: true },
    });
    return rows.map((r) => r.module);
  }

  async enableModule(organizationId: string, module: ModuleKey, expiresAt?: Date) {
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('expiresAt must be in the future');
    }

    // No OrgGuard runs in front of this route (it's @Public(), gated
    // only by AdminKeyGuard), so nothing upstream verifies orgId exists.
    await this.assertOrgExists(organizationId);

    // Dependency check: WORKSHOP_RMS requires INVOICE_POS active first.
    const dependsOn = MODULE_DEPENDENCIES[module];
    if (dependsOn) {
      const dependencyActive = await this.isModuleEnabled(organizationId, dependsOn);
      if (!dependencyActive) {
        throw new BadRequestException(
          `${module} requires ${dependsOn} to be active first`,
        );
      }
    }

    return this.prisma.organizationModule.upsert({
      where: { organizationId_module: { organizationId, module } },
      update: { enabled: true, expiresAt: expiresAt ?? null },
      create: {
        organizationId,
        module,
        enabled: true,
        expiresAt: expiresAt ?? null,
      },
    });
  }

  async disableModule(organizationId: string, module: ModuleKey) {
    // If disabling INVOICE_POS while WORKSHOP_RMS is still active, we
    // deliberately allow it here — ModuleGuard's request-time dependency
    // check is what stops WORKSHOP_RMS routes from working once
    // INVOICE_POS is gone, rather than silently cascading a disable
    // across modules the admin didn't ask to touch.
    try {
      return await this.prisma.organizationModule.update({
        where: { organizationId_module: { organizationId, module } },
        data: { enabled: false },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException(
          `Module ${module} is not configured for organization ${organizationId}`,
        );
      }
      throw err;
    }
  }

  async isModuleEnabled(organizationId: string, module: ModuleKey): Promise<boolean> {
    const row = await this.prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId, module } },
      select: { enabled: true, expiresAt: true },
    });

    if (!row || !row.enabled) return false;
    if (row.expiresAt && row.expiresAt <= new Date()) return false;
    return true;
  }

  async getModuleStatuses(
    organizationId: string,
  ): Promise<{ module: ModuleKey; purchased: boolean; enabled: boolean }[]> {
    const rows = await this.prisma.organizationModule.findMany({
      where: { organizationId },
      select: { module: true, enabled: true, expiresAt: true },
    });
    const byModule = new Map(rows.map((r) => [r.module, r]));

    return Object.values(ModuleKey).map((module) => {
      const row = byModule.get(module);
      if (!row) return { module, purchased: false, enabled: false };
      const notExpired = !row.expiresAt || row.expiresAt > new Date();
      return { module, purchased: true, enabled: row.enabled && notExpired };
    });
  }

  // Customer self-service toggle. Unlike enableModule (admin-only), this
  // NEVER creates a row — it only flips `enabled` on a module the org
  // already has. No existing row = never purchased = reject.
  async setModuleEnabled(
    organizationId: string,
    module: ModuleKey,
    enabled: boolean,
  ): Promise<{ module: ModuleKey; purchased: boolean; enabled: boolean }> {
    const existing = await this.prisma.organizationModule.findUnique({
      where: { organizationId_module: { organizationId, module } },
    });

    if (!existing) {
      throw new ForbiddenException(
        `Your organization has not purchased the ${module} module`,
      );
    }

    const expired = existing.expiresAt != null && existing.expiresAt <= new Date();
    if (expired && enabled) {
      throw new ForbiddenException(
        `Your ${module} module access has expired — contact support to renew`,
      );
    }

    // If turning ON a module that something else depends on, no extra
    // check needed. If turning ON WORKSHOP_RMS specifically, enforce the
    // same dependency enableModule() enforces at grant time.
    if (enabled) {
      const dependsOn = MODULE_DEPENDENCIES[module];
      if (dependsOn) {
        const dependencyActive = await this.isModuleEnabled(organizationId, dependsOn);
        if (!dependencyActive) {
          throw new ForbiddenException(
            `${module} requires ${dependsOn} to be active first`,
          );
        }
      }
    }

    const updated = await this.prisma.organizationModule.update({
      where: { organizationId_module: { organizationId, module } },
      data: { enabled },
    });

    return { module: updated.module, purchased: true, enabled: updated.enabled && !expired };
  }
}