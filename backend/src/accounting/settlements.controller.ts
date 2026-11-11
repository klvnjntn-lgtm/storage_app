import { Controller, Get, Logger, Req, UseGuards } from '@nestjs/common';
import { InvoiceStatus, ModuleKey, PaymentStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { scopedBranchId } from '../auth/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingReportsService, type APAgingLine } from './accounting-reports.service';

export type OpenReceivable = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerName: string | null;
  invoiceDate: Date | null;
  dueDate: Date | null;
  total: number;
  amountPaid: number;
  outstanding: number;
};

// Pelunasan: everything still to be settled in one list — invoices customers haven't paid off
// and purchase orders still owed to suppliers — so a payment can be recorded straight from it.
// Admin-only like supplier payments; a branch ADMIN sees their own branch's documents.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Roles('ADMIN')
@Controller('settlements')
export class SettlementsController {
  private readonly logger = new Logger(SettlementsController.name);

  constructor(
    private prisma: PrismaService,
    private reports: AccountingReportsService,
  ) {}

  @Get()
  async list(@CurrentOrg() organizationId: string, @Req() req) {
    const branchId = scopedBranchId(req.user);
    const [receivables, payables] = await Promise.all([
      this.receivables(organizationId, branchId),
      this.payables(organizationId, branchId),
    ]);
    return { receivables, payables };
  }

  // Straight from the invoices (not the ledger), so it works before the books are set up.
  // Outstanding is worked out the way the invoice page's balance due is.
  private async receivables(organizationId: string, branchId: string | null): Promise<OpenReceivable[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organizationId,
        status: InvoiceStatus.ISSUED,
        paymentStatus: { not: PaymentStatus.PAID },
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerName: true,
        customer: { select: { name: true } },
        invoiceDate: true,
        dueDate: true,
        issuedAt: true,
        createdAt: true,
        total: true,
        amountPaid: true,
        creditedAmount: true,
      },
    });
    return invoices
      .map((inv) => {
        const total = Number(inv.total);
        const amountPaid = Number(inv.amountPaid);
        const outstanding = Math.round((total - amountPaid - Number(inv.creditedAmount)) * 100) / 100;
        return {
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customer?.name ?? inv.customerName,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate ?? inv.invoiceDate ?? inv.issuedAt ?? inv.createdAt,
          total,
          amountPaid,
          outstanding,
        };
      })
      .filter((r) => r.outstanding > 0.005)
      .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
  }

  // What's owed on a PO comes from the ledger (goods received less returns and payments), the same
  // figure supplier payments check against — so it needs the books. Without them, nothing's listed.
  private async payables(organizationId: string, branchId: string | null): Promise<APAgingLine[]> {
    let lines: APAgingLine[];
    try {
      lines = (await this.reports.getAPAging(organizationId, new Date(), { all: true })).lines;
    } catch (err) {
      this.logger.warn(`Open payables unavailable for ${organizationId}: ${(err as Error).message}`);
      return [];
    }
    const open = lines.filter((l) => l.outstanding > 0.005);
    if (!branchId || open.length === 0) return open;
    const inBranch = await this.prisma.purchaseOrder.findMany({
      where: { organizationId, branchId, id: { in: open.map((l) => l.purchaseOrderId) } },
      select: { id: true },
    });
    const ids = new Set(inBranch.map((p) => p.id));
    return open.filter((l) => ids.has(l.purchaseOrderId));
  }
}
