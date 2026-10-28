import { CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

// Branch isolation for single-record routes: on a controller (or route)
// marked @BranchRecord('invoice'), a branch member asking for a record of
// another branch by its route param gets a 404, as if it didn't exist.
// Lists, creates and reports filter by branch themselves (branch-scope.ts).
export type BranchRecordModel =
  | 'invoice'
  | 'workOrder'
  | 'expense'
  | 'fixedAsset'
  | 'salesQuotation'
  | 'salesOrder'
  | 'deliveryOrder';

export const BRANCH_RECORD_KEY = 'branchRecord';
export const BranchRecord = (model: BranchRecordModel, param = 'id') =>
  SetMetadata(BRANCH_RECORD_KEY, { model, param });

const LABEL: Record<BranchRecordModel, string> = {
  invoice: 'Invoice',
  workOrder: 'Work order',
  expense: 'Expense',
  fixedAsset: 'Fixed asset',
  salesQuotation: 'Quotation',
  salesOrder: 'Sales order',
  deliveryOrder: 'Delivery order',
};

@Injectable()
export class BranchRecordGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<{ model: BranchRecordModel; param: string } | undefined>(
      BRANCH_RECORD_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!meta) return true;
    const req = ctx.switchToHttp().getRequest();
    const branchId: string | null | undefined = req.user?.branchId;
    const id: string | undefined = req.params?.[meta.param];
    if (!branchId || !id) return true;
    const delegate = this.prisma[meta.model] as unknown as {
      findFirst(args: object): Promise<{ branchId: string | null } | null>;
    };
    const row = await delegate.findFirst({
      where: { id, organizationId: req.organizationId ?? req.user?.organizationId },
      select: { branchId: true },
    });
    // Missing rows are left to the handler's own 404.
    if (row && row.branchId !== branchId) throw new NotFoundException(`${LABEL[meta.model]} not found`);
    return true;
  }
}
