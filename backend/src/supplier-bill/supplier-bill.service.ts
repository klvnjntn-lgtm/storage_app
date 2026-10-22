import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  JournalEntryStatus,
  JournalSourceType,
  PurchaseOrderStatus,
  SystemAccountKey,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountResolverService } from '../accounting/account-resolver.service';
import { parseDateOnly } from '../accounting/business-date';
import { CreateSupplierBillDto } from './dto/supplier-bill.dto';

// Within a rupiah counts as matched — PO discount/tax allocation rounds
// each receipt to the cent, and suppliers round their own totals.
const MATCH_TOLERANCE = 1;

export type MatchStatus =
  | 'NOT_BILLED'
  | 'MATCHED'
  | 'UNDER_BILLED'
  | 'OVER_BILLED';

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// Supplier bills and the three-way match: what was ordered (the PO), what
// was received (the AP goods receipts posted, less returns) and what the
// supplier billed. Bills post nothing to the ledger — AP is already booked
// at receipt — so recording, correcting or voiding one is always safe.
@Injectable()
export class SupplierBillService {
  constructor(
    private prisma: PrismaService,
    private accounts: AccountResolverService,
  ) {}

  async list(
    organizationId: string,
    opts: { supplierId?: string; status?: MatchStatus } = {},
  ) {
    const bills = await this.prisma.supplierBill.findMany({
      where: {
        organizationId,
        voidedAt: null,
        ...(opts.supplierId && { supplierId: opts.supplierId }),
      },
      include: {
        purchaseOrder: { select: { id: true, poNumber: true, total: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const poIds = [...new Set(bills.map((b) => b.purchaseOrderId))];
    const matches = await this.matchMany(organizationId, poIds);
    const rows = bills.map((b) => ({
      ...b,
      match: matches.get(b.purchaseOrderId)!,
    }));
    return opts.status
      ? rows.filter((r) => r.match.status === opts.status)
      : rows;
  }

  async create(
    organizationId: string,
    userId: string,
    purchaseOrderId: string,
    dto: CreateSupplierBillDto,
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        'Send the purchase order before recording the supplier’s bill',
      );
    }
    const billNumber = dto.billNumber.trim();
    if (!billNumber) throw new BadRequestException('billNumber is required');
    const billDate = parseDateOnly(dto.billDate, 'billDate');
    const dueDate = dto.dueDate ? parseDateOnly(dto.dueDate, 'dueDate') : null;
    if (dueDate && dueDate < billDate)
      throw new BadRequestException('dueDate cannot be before billDate');

    // The same supplier invoice number entered twice is almost always a
    // duplicate data entry, not two bills.
    const duplicate = await this.prisma.supplierBill.findFirst({
      where: {
        organizationId,
        supplierId: po.supplierId,
        billNumber,
        voidedAt: null,
      },
    });
    if (duplicate)
      throw new ConflictException(
        `Bill ${billNumber} from this supplier is already recorded`,
      );

    return this.prisma.supplierBill.create({
      data: {
        organizationId,
        purchaseOrderId,
        supplierId: po.supplierId,
        billNumber,
        billDate,
        dueDate,
        amount: dto.amount,
        notes: dto.notes?.trim() || null,
        createdById: userId,
      },
    });
  }

  async void(organizationId: string, id: string) {
    const bill = await this.prisma.supplierBill.findFirst({
      where: { id, organizationId, voidedAt: null },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    return this.prisma.supplierBill.update({
      where: { id },
      data: { voidedAt: new Date() },
    });
  }

  // The three-way match for one PO, with the per-line quantities behind it.
  async match(organizationId: string, purchaseOrderId: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id: purchaseOrderId, organizationId },
      include: {
        items: { include: { product: { select: { name: true, sku: true } } } },
        supplierBills: {
          where: { voidedAt: null },
          orderBy: { billDate: 'asc' },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    const [summary, received, returned] = await Promise.all([
      this.matchMany(organizationId, [po.id]).then((m) => m.get(po.id)!),
      this.prisma.goodsReceiptItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { goodsReceipt: { purchaseOrderId: po.id } },
        _sum: { quantity: true },
      }),
      this.prisma.purchaseReturnItem.groupBy({
        by: ['purchaseOrderItemId'],
        where: { purchaseReturn: { purchaseOrderId: po.id } },
        _sum: { quantity: true },
      }),
    ]);
    const receivedBy = new Map(
      received.map((r) => [
        r.purchaseOrderItemId,
        Number(r._sum.quantity ?? 0),
      ]),
    );
    const returnedBy = new Map(
      returned.map((r) => [
        r.purchaseOrderItemId,
        Number(r._sum.quantity ?? 0),
      ]),
    );

    return {
      ...summary,
      bills: po.supplierBills,
      lines: po.items.map((item) => ({
        purchaseOrderItemId: item.id,
        description: item.product?.name ?? item.description,
        sku: item.product?.sku ?? null,
        ordered: Number(item.quantity),
        received: round2(
          (receivedBy.get(item.id) ?? 0) +
            Number(item.importedReceivedQuantity),
        ),
        returned: returnedBy.get(item.id) ?? 0,
        unitCost: Number(item.unitCost),
      })),
    };
  }

  // ordered / received / billed per PO in a handful of queries. "Received"
  // is the AP the receipts posted less what returns took back — the same
  // figure supplier payments are checked against — so a matched bill means
  // "pay exactly this".
  private async matchMany(organizationId: string, poIds: string[]) {
    const result = new Map<
      string,
      {
        purchaseOrderId: string;
        ordered: number;
        received: number;
        billed: number;
        status: MatchStatus;
        difference: number;
      }
    >();
    if (poIds.length === 0) return result;

    const apAccountId = await this.accounts.resolve(
      organizationId,
      SystemAccountKey.ACCOUNTS_PAYABLE,
    );
    const [pos, receipts, returns, bills] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { id: { in: poIds }, organizationId },
        select: { id: true, total: true },
      }),
      this.prisma.goodsReceipt.findMany({
        where: { organizationId, purchaseOrderId: { in: poIds } },
        select: { id: true, purchaseOrderId: true },
      }),
      this.prisma.purchaseReturn.groupBy({
        by: ['purchaseOrderId'],
        where: { organizationId, purchaseOrderId: { in: poIds } },
        _sum: { total: true },
      }),
      this.prisma.supplierBill.groupBy({
        by: ['purchaseOrderId'],
        where: {
          organizationId,
          purchaseOrderId: { in: poIds },
          voidedAt: null,
        },
        _sum: { amount: true },
      }),
    ]);
    // Bills imported from Accurate: their goods arrived before WareSys, so
    // with no receipt on the PO the imported bill stands in for "received"
    // (same rule as SupplierPaymentsService.getOutstanding and AP Aging).
    const importedBills = await this.prisma.supplierBill.groupBy({
      by: ['purchaseOrderId'],
      where: { organizationId, purchaseOrderId: { in: poIds }, voidedAt: null, externalId: { not: null } },
      _sum: { amount: true },
    });
    const importedByPo = new Map(importedBills.map((b) => [b.purchaseOrderId, Number(b._sum.amount ?? 0)]));
    const poWithReceipts = new Set(receipts.map((r) => r.purchaseOrderId));

    const receiptToPo = new Map(receipts.map((r) => [r.id, r.purchaseOrderId]));
    const creditedByPo = new Map<string, number>();
    if (receipts.length > 0) {
      const lines = await this.prisma.journalEntryLine.findMany({
        where: {
          accountId: apAccountId,
          journalEntry: {
            organizationId,
            status: JournalEntryStatus.POSTED,
            sourceType: JournalSourceType.GOODS_RECEIPT,
            sourceId: { in: [...receiptToPo.keys()] },
          },
        },
        select: { credit: true, journalEntry: { select: { sourceId: true } } },
      });
      for (const l of lines) {
        const poId = receiptToPo.get(l.journalEntry.sourceId ?? '');
        if (poId)
          creditedByPo.set(
            poId,
            (creditedByPo.get(poId) ?? 0) + Number(l.credit),
          );
      }
    }
    const returnedByPo = new Map(
      returns.map((r) => [r.purchaseOrderId, Number(r._sum.total ?? 0)]),
    );
    const billedByPo = new Map(
      bills.map((b) => [b.purchaseOrderId, Number(b._sum.amount ?? 0)]),
    );

    for (const po of pos) {
      const credited = poWithReceipts.has(po.id)
        ? (creditedByPo.get(po.id) ?? 0)
        : (importedByPo.get(po.id) ?? 0);
      const received = round2(credited - (returnedByPo.get(po.id) ?? 0));
      const billed = round2(billedByPo.get(po.id) ?? 0);
      const difference = round2(billed - received);
      const status: MatchStatus =
        billed === 0
          ? 'NOT_BILLED'
          : Math.abs(difference) <= MATCH_TOLERANCE
            ? 'MATCHED'
            : difference > 0
              ? 'OVER_BILLED'
              : 'UNDER_BILLED';
      result.set(po.id, {
        purchaseOrderId: po.id,
        ordered: Number(po.total),
        received,
        billed,
        status,
        difference,
      });
    }
    return result;
  }
}
