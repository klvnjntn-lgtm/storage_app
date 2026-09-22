import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentMode } from '@prisma/client';
import { DEFAULT_TIMEZONE } from '../accounting/business-date';

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
};

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
  constructor(private prisma: PrismaService) {}

  async getSettings(orgId: string) {
    const org = await this.prisma.organization.findUnique({
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
      },
    });
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
    };
  }

  async updateSettings(orgId: string, input: UpdateOrganizationSettingsInput) {
    const { fulfillmentMode, posPricingEnabled, taxEnabled, timezone, ...rest } = input;

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

    return this.prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(fulfillmentMode !== undefined && { fulfillmentMode }),
        ...(posPricingEnabled !== undefined && { posPricingEnabled }),
        ...(taxEnabled !== undefined && { taxEnabled }),
        ...(timezone !== undefined && { timezone }),
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
      },
    });
  }
}