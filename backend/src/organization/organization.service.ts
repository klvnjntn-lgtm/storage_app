import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentMode, ModuleKey, StockPolicy } from '@prisma/client';
import { DEFAULT_TIMEZONE } from '../accounting/business-date';
import { OrganizationModulesService } from '../organization-module/organization-modules.service';

export type UpdateOrganizationSettingsInput = {
  fulfillmentMode?: FulfillmentMode;
  posPricingEnabled?: boolean;
  legalName?: string;
  npwp?: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  taxEnabled?: boolean;
  timezone?: string;
  stockPolicy?: StockPolicy;
  stockOverrideRequiresAdmin?: boolean;
};

// Settings changes worth a durable "who changed what, when" record. Every
// field in UpdateOrganizationSettingsInput could go here in principle;
// starting with just the stock policy fields since that's what currently
// needs auditing.
const AUDITED_FIELDS = ['stockPolicy', 'stockOverrideRequiresAdmin'] as const;

const STRING_FIELDS = ['legalName', 'npwp', 'logoUrl', 'address', 'phone'] as const;

const MAX_STRING_FIELD_LENGTH = 200;

// Validates by actually asking the platform rather than maintaining a list —
// Intl.DateTimeFormat throws RangeError on an unknown IANA zone name, same
// check business-date.ts's getDateFormatter() relies on at posting time. Better
// to reject a typo here than have it surface as a 500 on the next invoice.
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class OrganizationService {
  constructor(
    private prisma: PrismaService,
    private modules: OrganizationModulesService,
  ) {}

  async getSettings(orgId: string) {
    const [org, hasWarehouseOps] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: orgId },
        select: {
          fulfillmentMode: true,
          posPricingEnabled: true,
          legalName: true,
          npwp: true,
          logoUrl: true,
          address: true,
          phone: true,
          taxEnabled: true,
          timezone: true,
          stockPolicy: true,
          stockOverrideRequiresAdmin: true,
        },
      }),
      this.modules.isModuleEnabled(orgId, ModuleKey.WAREHOUSE_OPS),
    ]);
    return {
      fulfillmentMode: org?.fulfillmentMode ?? FulfillmentMode.PICK_PACK_SHIP,
      posPricingEnabled: org?.posPricingEnabled ?? false,
      legalName: org?.legalName ?? null,
      npwp: org?.npwp ?? null,
      logoUrl: org?.logoUrl ?? null,
      address: org?.address ?? null,
      phone: org?.phone ?? null,
      taxEnabled: org?.taxEnabled ?? false,
      timezone: org?.timezone ?? DEFAULT_TIMEZONE,
      // Pick/pack/ship always deducts stock strictly (StockService.decrease(),
      // session PICK stage) — that path doesn't read this field at all, so
      // report it as fixed BLOCK/no-override for a warehouse-ops org
      // regardless of whatever value is stored, rather than show a setting
      // that silently does nothing.
      stockPolicy: hasWarehouseOps ? StockPolicy.BLOCK : (org?.stockPolicy ?? StockPolicy.BLOCK),
      stockOverrideRequiresAdmin: hasWarehouseOps ? false : (org?.stockOverrideRequiresAdmin ?? false),
    };
  }

  async updateSettings(orgId: string, input: UpdateOrganizationSettingsInput, userId?: string) {
    const { fulfillmentMode, posPricingEnabled, taxEnabled, timezone, stockPolicy, stockOverrideRequiresAdmin, ...rest } = input;

    const providedKeys = Object.keys(input) as (keyof UpdateOrganizationSettingsInput)[];
    if (providedKeys.length === 0) {
      throw new BadRequestException('At least one setting must be provided');
    }

    if (
      fulfillmentMode !== undefined &&
      !Object.values(FulfillmentMode).includes(fulfillmentMode)
    ) {
      throw new BadRequestException(
        `fulfillmentMode must be one of: ${Object.values(FulfillmentMode).join(', ')}`,
      );
    }

    if (posPricingEnabled !== undefined && typeof posPricingEnabled !== 'boolean') {
      throw new BadRequestException('posPricingEnabled must be a boolean');
    }

    if (taxEnabled !== undefined && typeof taxEnabled !== 'boolean') {
      throw new BadRequestException('taxEnabled must be a boolean');
    }

    if (timezone !== undefined && (typeof timezone !== 'string' || !isValidTimezone(timezone))) {
      throw new BadRequestException('timezone must be a valid IANA timezone name (e.g. Asia/Jakarta)');
    }

    if (stockPolicy !== undefined && !Object.values(StockPolicy).includes(stockPolicy)) {
      throw new BadRequestException(
        `stockPolicy must be one of: ${Object.values(StockPolicy).join(', ')}`,
      );
    }

    if (stockOverrideRequiresAdmin !== undefined && typeof stockOverrideRequiresAdmin !== 'boolean') {
      throw new BadRequestException('stockOverrideRequiresAdmin must be a boolean');
    }

    // Pick/pack/ship's stock deduction (StockService.decrease(), session
    // PICK stage) is always strict and never reads this field — configuring
    // it for a warehouse-ops org would be a setting that silently does
    // nothing, so reject the write outright instead.
    if (stockPolicy !== undefined || stockOverrideRequiresAdmin !== undefined) {
      const hasWarehouseOps = await this.modules.isModuleEnabled(orgId, ModuleKey.WAREHOUSE_OPS);
      if (hasWarehouseOps) {
        throw new BadRequestException(
          'Stock policy is not configurable for organizations with WAREHOUSE_OPS enabled — pick/pack/ship stock deduction is always strict.',
        );
      }
    }

    for (const field of STRING_FIELDS) {
      const value = rest[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        throw new BadRequestException(`${field} must be a string`);
      }
      if (value.length > MAX_STRING_FIELD_LENGTH) {
        throw new BadRequestException(`${field} cannot exceed ${MAX_STRING_FIELD_LENGTH} characters`);
      }
    }

    const touchedAuditedFields = AUDITED_FIELDS.filter((f) => input[f] !== undefined);
    const before = touchedAuditedFields.length
      ? await this.prisma.organization.findUnique({
          where: { id: orgId },
          select: { stockPolicy: true, stockOverrideRequiresAdmin: true },
        })
      : null;

    const updated = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(fulfillmentMode !== undefined && { fulfillmentMode }),
        ...(posPricingEnabled !== undefined && { posPricingEnabled }),
        ...(taxEnabled !== undefined && { taxEnabled }),
        ...(timezone !== undefined && { timezone }),
        ...(stockPolicy !== undefined && { stockPolicy }),
        ...(stockOverrideRequiresAdmin !== undefined && { stockOverrideRequiresAdmin }),
        ...(rest.legalName !== undefined && { legalName: rest.legalName.trim() }),
        ...(rest.npwp !== undefined && { npwp: rest.npwp.trim() }),
        ...(rest.logoUrl !== undefined && { logoUrl: rest.logoUrl.trim() }),
        ...(rest.address !== undefined && { address: rest.address.trim() }),
        ...(rest.phone !== undefined && { phone: rest.phone.trim() }),
      },
      select: {
        fulfillmentMode: true,
        posPricingEnabled: true,
        legalName: true,
        npwp: true,
        logoUrl: true,
        address: true,
        phone: true,
        taxEnabled: true,
        timezone: true,
        stockPolicy: true,
        stockOverrideRequiresAdmin: true,
      },
    });

    if (before) {
      await this.prisma.settingsAuditLog.createMany({
        data: touchedAuditedFields
          .filter((f) => String(before[f]) !== String(input[f]))
          .map((f) => ({
            organizationId: orgId,
            field: f,
            oldValue: String(before[f]),
            newValue: String(input[f]),
            userId: userId ?? null,
          })),
      });
    }

    return updated;
  }
}