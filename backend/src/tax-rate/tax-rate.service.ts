import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaxRateDto, UpdateTaxRateDto, UpsertDefaultTaxRateDto } from './dto/tax-rates.dto';

@Injectable()
export class TaxRateService {
  constructor(private prisma: PrismaService) {}

  list(organizationId: string, includeArchived = false) {
    return this.prisma.organizationTaxRate.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(organizationId: string, dto: CreateTaxRateDto) {
    return this.prisma.organizationTaxRate.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        percentage: dto.percentage,
      },
    });
  }

  async update(organizationId: string, id: string, dto: UpdateTaxRateDto) {
    await this.assertOwned(organizationId, id);

    if (dto.isDefault) {
      // Only one default at a time — unset any other default first.
      return this.prisma.$transaction(async (tx) => {
        await tx.organizationTaxRate.updateMany({
          where: { organizationId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
        return tx.organizationTaxRate.update({
          where: { id },
          data: {
            ...(dto.name !== undefined && { name: dto.name.trim() }),
            ...(dto.percentage !== undefined && { percentage: dto.percentage }),
            isDefault: true,
          },
        });
      });
    }

    return this.prisma.organizationTaxRate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.percentage !== undefined && { percentage: dto.percentage }),
        ...(dto.isDefault === false && { isDefault: false }),
      },
    });
  }

  // Archive rather than delete — invoices that already applied this
  // preset keep their own InvoiceItemTax/InvoiceTax snapshot regardless,
  // but archiving (instead of hard delete) means we never have to worry
  // about a dangling taxRateId anywhere, and the preset can be restored
  // if archived by mistake.
  //
  // FIXED: also clears isDefault when archiving. Previously an archived
  // rate could stay flagged isDefault: true, so getDefault() (and the
  // invoice/new "seed the line with the default rate" logic) would point
  // at a rate that no longer shows up anywhere in the active list.
  async archive(organizationId: string, id: string) {
    await this.assertOwned(organizationId, id);
    return this.prisma.organizationTaxRate.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    });
  }

  // ---- default rate (legacy Settings single-default flow) --------------
  // Superseded by the CRUD above + isDefault on update(), now that Settings
  // manages a list of rates instead of one on/off default. Kept here in
  // case anything still calls the /default routes — safe to delete along
  // with UpsertDefaultTaxRateDto and the controller's default/default-disable
  // routes once you've confirmed nothing else depends on them.

  getDefault(organizationId: string) {
    return this.prisma.organizationTaxRate.findFirst({
      where: { organizationId, isDefault: true },
    });
  }

  // FIXED: now unsets isDefault on every other rate first, same as
  // update() does. Previously this could leave two rows flagged
  // isDefault: true at once if the new per-rate update() path had
  // already been used to set a different default.
  async upsertDefault(organizationId: string, dto: UpsertDefaultTaxRateDto) {
    const existing = await this.getDefault(organizationId);
    const name = dto.name.trim();

    return this.prisma.$transaction(async (tx) => {
      await tx.organizationTaxRate.updateMany({
        where: {
          organizationId,
          isDefault: true,
          ...(existing ? { id: { not: existing.id } } : {}),
        },
        data: { isDefault: false },
      });

      if (!existing) {
        return tx.organizationTaxRate.create({
          data: { organizationId, name, percentage: dto.percentage, isDefault: true },
        });
      }

      return tx.organizationTaxRate.update({
        where: { id: existing.id },
        data: { name, percentage: dto.percentage, archivedAt: null, isDefault: true },
      });
    });
  }

  async disableDefault(organizationId: string) {
    const existing = await this.getDefault(organizationId);
    if (!existing) return null;
    return this.prisma.organizationTaxRate.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isDefault: false },
    });
  }

  private async assertOwned(organizationId: string, id: string) {
    const rate = await this.prisma.organizationTaxRate.findFirst({
      where: { id, organizationId },
    });
    if (!rate) throw new NotFoundException('Tax rate not found');
    return rate;
  }
}