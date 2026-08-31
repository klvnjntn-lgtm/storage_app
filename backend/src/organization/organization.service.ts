import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FulfillmentMode } from '@prisma/client';

export type UpdateOrganizationSettingsInput = {
  fulfillmentMode?: FulfillmentMode;
  posPricingEnabled?: boolean;
  legalName?: string;
  npwp?: string;
  logoUrl?: string;
  bankName?: string;
  address?: string;
  phone?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  taxEnabled?: boolean;
};

const STRING_FIELDS = [
  'legalName',
  'npwp',
  'logoUrl',
  'bankName',
  'address',
  'phone',
  'bankAccountNumber',
  'bankAccountName',
] as const;

const MAX_STRING_FIELD_LENGTH = 200;

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
        bankName: true,
        address: true,
        phone: true,
        bankAccountNumber: true,
        bankAccountName: true,
        taxEnabled: true,
      },
    });
    return {
      fulfillmentMode: org?.fulfillmentMode ?? FulfillmentMode.PICK_PACK_SHIP,
      posPricingEnabled: org?.posPricingEnabled ?? false,
      legalName: org?.legalName ?? null,
      npwp: org?.npwp ?? null,
      logoUrl: org?.logoUrl ?? null,
      bankName: org?.bankName ?? null,
      address: org?.address ?? null,
      phone: org?.phone ?? null,
      bankAccountNumber: org?.bankAccountNumber ?? null,
      bankAccountName: org?.bankAccountName ?? null,
      taxEnabled: org?.taxEnabled ?? false,
    };
  }

  async updateSettings(orgId: string, input: UpdateOrganizationSettingsInput) {
    const { fulfillmentMode, posPricingEnabled, taxEnabled, ...rest } = input;

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
        ...(rest.legalName !== undefined && { legalName: rest.legalName.trim() }),
        ...(rest.npwp !== undefined && { npwp: rest.npwp.trim() }),
        ...(rest.logoUrl !== undefined && { logoUrl: rest.logoUrl.trim() }),
        ...(rest.bankName !== undefined && { bankName: rest.bankName.trim() }),
        ...(rest.address !== undefined && { address: rest.address.trim() }),
        ...(rest.phone !== undefined && { phone: rest.phone.trim() }),
        ...(rest.bankAccountNumber !== undefined && { bankAccountNumber: rest.bankAccountNumber.trim() }),
        ...(rest.bankAccountName !== undefined && { bankAccountName: rest.bankAccountName.trim() }),
      },
      select: {
        fulfillmentMode: true,
        posPricingEnabled: true,
        legalName: true,
        npwp: true,
        logoUrl: true,
        bankName: true,
        address: true,
        phone: true,
        bankAccountNumber: true,
        bankAccountName: true,
        taxEnabled: true,
      },
    });
  }
}