import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DepreciationMethod, FixedAssetStatus, JournalSourceType, PaymentMethod, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PostingRulesService } from './posting-rules.service';
import { JournalService } from './journal.service';
import { parseDateOnly } from './business-date';
import {
  CreateFixedAssetDto,
  DisposeFixedAssetDto,
  RecordFixedAssetPaymentDto,
} from './dto/fixed-asset.dto';

const EPS = 0.005; // half a cent: amounts are 2dp, so anything smaller is float noise

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Whole calendar months elapsed from `from` up to `to`, both UTC-midnight
// date-only values. Jan 15 -> Feb 15 is 1 month; Jan 15 -> Feb 10 is 0 (not
// a full month yet). This is the standard "day-of-month" convention for
// month-based straight-line depreciation — it doesn't special-case month
// lengths (Jan 31 -> Feb 28 behaves like any other day-of-month shortfall).
function wholeMonthsBetween(from: Date, to: Date): number {
  if (to.getTime() <= from.getTime()) return 0;
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(months, 0);
}

function addMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

// Converts Decimal fields to number for stable JSON, same reason
// ExpensesService does it — Prisma Decimals otherwise serialize as strings.
function serialize<T extends {
  cost: Prisma.Decimal;
  salvageValue: Prisma.Decimal;
  accumulatedDepreciation: Prisma.Decimal;
  amountPaid: Prisma.Decimal;
  disposalProceeds: Prisma.Decimal | null;
  payments?: { amount: Prisma.Decimal }[];
}>(asset: T) {
  const cost = Number(asset.cost);
  const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
  return {
    ...asset,
    cost,
    salvageValue: Number(asset.salvageValue),
    accumulatedDepreciation,
    amountPaid: Number(asset.amountPaid),
    disposalProceeds: asset.disposalProceeds != null ? Number(asset.disposalProceeds) : null,
    netBookValue: round2(cost - accumulatedDepreciation),
    ...(asset.payments && { payments: asset.payments.map((p) => ({ ...p, amount: Number(p.amount) })) }),
  };
}

@Injectable()
export class FixedAssetsService {
  constructor(
    private prisma: PrismaService,
    private postingRules: PostingRulesService,
    private journal: JournalService,
  ) {}

  async list(
    organizationId: string,
    filters: { status?: FixedAssetStatus; page?: number; pageSize?: number },
  ) {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const pageSize = filters.pageSize && filters.pageSize > 0 ? Math.min(filters.pageSize, 200) : 20;
    const where = { organizationId, status: filters.status };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.fixedAsset.findMany({
        where,
        include: { location: { select: { name: true } } },
        orderBy: { acquisitionDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.fixedAsset.count({ where }),
    ]);

    return { data: data.map(serialize), total, page, pageSize };
  }

  async get(organizationId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, organizationId },
      include: {
        location: { select: { name: true } },
        payments: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return serialize(asset);
  }

  // Posts Fixed Assets (debit) + Fixed Asset Payable (credit) for the full
  // cost in the SAME transaction as the row write, same reasoning as
  // ExpensesService.create(): never leave a FixedAsset row with no matching
  // ledger entry. Payment (if any) is a separate step via recordPayment(),
  // same record-then-pay split as Expense.
  async create(organizationId: string, dto: CreateFixedAssetDto, userId?: string) {
    if (dto.locationId) {
      const location = await this.prisma.location.findFirst({ where: { id: dto.locationId, organizationId } });
      if (!location) throw new BadRequestException('locationId does not refer to a valid location for this organization');
    }

    const salvageValue = dto.salvageValue ?? 0;
    if (salvageValue >= dto.cost) {
      throw new BadRequestException('salvageValue must be less than cost');
    }

    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          category: dto.category?.trim(),
          locationId: dto.locationId,
          acquisitionDate: parseDateOnly(dto.acquisitionDate, 'acquisitionDate'),
          cost: dto.cost,
          salvageValue,
          usefulLifeMonths: dto.usefulLifeMonths,
          depreciationMethod: dto.depreciationMethod ?? DepreciationMethod.STRAIGHT_LINE,
          notes: dto.notes?.trim(),
          userId,
        },
      });

      await this.postingRules.postFixedAssetAcquired(organizationId, asset.id, tx);

      return serialize(asset);
    });
  }

  // FIX — mirrors ExpensesService.recordPayment(): validates the amount
  // doesn't exceed the remaining balance, creates one FixedAssetPayment row
  // per installment (each gets its own ledger entry, see
  // postFixedAssetPayment), and advances amountPaid.
  async recordPayment(
    organizationId: string,
    assetId: string,
    dto: RecordFixedAssetPaymentDto,
    userId?: string,
  ) {
    if (!(dto.amount > 0)) {
      throw new BadRequestException('Payment amount must be greater than zero');
    }

    const method = dto.method ?? PaymentMethod.CASH;
    if (method !== PaymentMethod.CASH) {
      if (!dto.bankAccountId) {
        throw new BadRequestException(`bankAccountId is required for payment method ${method}`);
      }
      const bankAccount = await this.prisma.organizationBankAccount.findFirst({
        where: { id: dto.bankAccountId, organizationId, archivedAt: null },
      });
      if (!bankAccount) {
        throw new BadRequestException('bankAccountId does not refer to an active bank account for this organization');
      }
    }

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          const asset = await tx.fixedAsset.findFirst({
            where: { id: assetId, organizationId },
            select: { id: true, cost: true, amountPaid: true, status: true },
          });
          if (!asset) throw new NotFoundException('Fixed asset not found');
          if (asset.status !== FixedAssetStatus.ACTIVE) {
            throw new BadRequestException('Cannot record a payment against a disposed fixed asset');
          }

          const total = Number(asset.cost);
          const alreadyPaid = Number(asset.amountPaid);
          const balance = round2(total - alreadyPaid);

          if (dto.amount > balance + EPS) {
            throw new BadRequestException(`Payment of ${dto.amount} exceeds balance due (${balance})`);
          }

          const payment = await tx.fixedAssetPayment.create({
            data: {
              fixedAssetId: assetId,
              amount: dto.amount,
              method,
              note: dto.note,
              recordedById: userId,
              createdAt: dto.paidAt ? new Date(dto.paidAt) : undefined,
              // CASH is never tied to a specific bank account, same policy as ExpensePayment.
              bankAccountId: method === PaymentMethod.CASH ? null : dto.bankAccountId,
            },
          });

          const result = await tx.fixedAsset.update({
            where: { id: assetId },
            data: { amountPaid: round2(alreadyPaid + dto.amount) },
            include: { payments: { orderBy: { createdAt: 'desc' } } },
          });

          await this.postingRules.postFixedAssetPayment(organizationId, payment.id, tx);

          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return serialize(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
        throw new ConflictException('Payment conflicted with a concurrent update, please retry');
      }
      throw e;
    }
  }

  // Straight-line depreciation, run for every ACTIVE asset whose
  // acquisitionDate is on/before `throughDate`. Idempotent per asset via
  // an atomic claim on lastDepreciatedThrough (read-then-conditional-update,
  // same "claim" pattern used elsewhere in this codebase e.g.
  // InvoiceService.issue()'s fulfillmentPath claim) — a concurrent or
  // repeated call for the same period advances nothing and posts nothing
  // for an asset another call already caught up.
  async runDepreciation(organizationId: string, throughDate: Date) {
    const assets = await this.prisma.fixedAsset.findMany({
      where: { organizationId, status: FixedAssetStatus.ACTIVE, acquisitionDate: { lte: throughDate } },
    });

    const posted: { assetId: string; name: string; monthsDepreciated: number; amount: number }[] = [];

    for (const asset of assets) {
      const depreciableBase = round2(Number(asset.cost) - Number(asset.salvageValue));
      if (depreciableBase <= 0 || asset.usefulLifeMonths <= 0) continue;

      const alreadyDepreciated = Number(asset.accumulatedDepreciation);
      const remainingDepreciable = round2(depreciableBase - alreadyDepreciated);
      if (remainingDepreciable <= 0) continue; // fully depreciated already

      const from = asset.lastDepreciatedThrough ?? asset.acquisitionDate;
      const monthsElapsed = wholeMonthsBetween(from, throughDate);
      if (monthsElapsed <= 0) continue;

      const monthlyAmount = depreciableBase / asset.usefulLifeMonths;
      const amount = Math.min(round2(monthlyAmount * monthsElapsed), remainingDepreciable);
      if (amount <= 0) continue;

      const newThrough = addMonths(from, monthsElapsed);

      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.fixedAsset.updateMany({
          where: { id: asset.id, organizationId, lastDepreciatedThrough: asset.lastDepreciatedThrough },
          data: {
            accumulatedDepreciation: { increment: amount },
            lastDepreciatedThrough: newThrough,
          },
        });
        if (claimed.count === 0) return; // a concurrent run already advanced this asset

        await this.postingRules.postFixedAssetDepreciation(
          organizationId,
          {
            sourceId: `${asset.id}:depreciation:${newThrough.toISOString().slice(0, 10)}`,
            date: throughDate,
            assetId: asset.id,
            assetName: asset.name,
            locationId: asset.locationId,
            amount,
          },
          tx,
        );

        posted.push({ assetId: asset.id, name: asset.name, monthsDepreciated: monthsElapsed, amount });
      });
    }

    return { throughDate, assetsDepreciated: posted.length, entries: posted };
  }

  // Removes an asset from the books: clears its remaining cost/accumulated
  // depreciation, recognizes a gain or loss against proceeds, and (if
  // proceeds > 0) records the cash received. status flips atomically via a
  // claim update, so a double-dispose call can't post the reversal twice.
  async dispose(organizationId: string, id: string, dto: DisposeFixedAssetDto) {
    const proceeds = dto.proceeds ?? 0;
    if (proceeds > 0 && !dto.method) {
      throw new BadRequestException('A payment method is required when disposal proceeds are greater than zero');
    }
    const disposedAt = dto.disposedAt ? parseDateOnly(dto.disposedAt, 'disposedAt') : new Date();

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.fixedAsset.updateMany({
        where: { id, organizationId, status: FixedAssetStatus.ACTIVE },
        data: { status: FixedAssetStatus.DISPOSED, disposedAt, disposalProceeds: proceeds },
      });
      if (claimed.count === 0) {
        throw new BadRequestException('Fixed asset not found, or is not currently active');
      }

      await this.postingRules.postFixedAssetDisposal(
        organizationId,
        id,
        proceeds > 0 ? { method: dto.method, bankAccountId: dto.bankAccountId } : null,
        tx,
      );

      const updated = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      return serialize(updated);
    });
  }

  // Only lets go of an asset that was never actually put into service
  // financially — no payments, no depreciation taken. Anything past that
  // point is real accounting history; the correction for a mistake there is
  // disposal (or a manual adjusting entry), not deletion, same policy as
  // ExpensesService.voidUnpaid().
  async voidUnrecorded(organizationId: string, id: string, userId?: string, reason?: string) {
    const asset = await this.prisma.fixedAsset.findFirst({ where: { id, organizationId } });
    if (!asset) throw new NotFoundException('Fixed asset not found');
    if (asset.status !== FixedAssetStatus.ACTIVE) {
      throw new BadRequestException('Cannot delete a disposed fixed asset');
    }
    if (Number(asset.amountPaid) > 0) {
      throw new BadRequestException('Cannot delete a fixed asset that has payments recorded');
    }
    if (Number(asset.accumulatedDepreciation) > 0) {
      throw new BadRequestException('Cannot delete a fixed asset that has already been depreciated');
    }

    return this.prisma.$transaction(async (tx) => {
      const entry = await this.journal.findPostedBySource(
        organizationId,
        JournalSourceType.FIXED_ASSET_PURCHASE,
        `${id}:acquired`,
        tx,
      );
      if (entry) {
        await this.journal.voidEntry(organizationId, entry.id, userId, reason, tx);
      }
      return tx.fixedAsset.delete({ where: { id } });
    });
  }
}
