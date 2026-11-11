import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrintDocType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopedUser, assertBranchAccess, bookingBranchId, scopedBranchId } from '../auth/branch-scope';
import { PAPER_SIZES, PaperSize, validateLayout } from './layout-validator';

export const DOC_TYPES = Object.values(PrintDocType);

export type CreatePrintTemplateInput = {
  docType: PrintDocType;
  name: string;
  paperSize: string;
  layout: unknown;
  branchId?: string | null;
  isDefault?: boolean;
};

export type UpdatePrintTemplateInput = {
  name?: string;
  paperSize?: string;
  layout?: unknown;
};

// What a print needs from a template: enough to draw it.
export type ResolvedPrintTemplate = { id: string; name: string; paperSize: string; layout: Prisma.JsonValue };

// Retried once on a race between two "make default" calls; the partial
// unique index (one default per branch, type and paper) is the real guard.
const DEFAULT_CLASH = 'P2002';

@Injectable()
export class PrintTemplatesService {
  constructor(private prisma: PrismaService) {}

  // A branch member sees their own branch's designs; MASTER any branch's
  // (or every branch's, with no branchId).
  list(organizationId: string, user: BranchScopedUser, opts: { docType?: string; branchId?: string }) {
    const docType = opts.docType ? this.docType(opts.docType) : undefined;
    const branchId = scopedBranchId(user) ?? (opts.branchId || undefined);
    return this.prisma.printTemplate.findMany({
      where: { organizationId, ...(docType && { docType }), ...(branchId && { branchId }) },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ docType: 'asc' }, { isDefault: 'desc' }, { name: 'asc' }],
    });
  }

  async get(organizationId: string, id: string, user: BranchScopedUser) {
    const template = await this.prisma.printTemplate.findFirst({
      where: { id, organizationId },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (!template) throw new NotFoundException('Print design not found');
    assertBranchAccess(user, template.branchId, 'Print design');
    return template;
  }

  async create(organizationId: string, user: BranchScopedUser, input: CreatePrintTemplateInput) {
    const docType = this.docType(input.docType);
    const paperSize = this.paper(input.paperSize);
    const branchId = await this.branchFor(organizationId, user, input.branchId ?? null);
    const layout = validateLayout(input.layout, paperSize);
    const name = this.name(input.name);
    return this.withDefaultRetry(() =>
      this.prisma.$transaction(async (tx) => {
        // The first design of its kind at a branch prints by default.
        const hasDefault = await tx.printTemplate.count({
          where: { organizationId, branchId, docType, paperSize, isDefault: true },
        });
        const isDefault = input.isDefault ?? hasDefault === 0;
        if (isDefault) await this.clearDefault(tx, organizationId, branchId, docType, paperSize);
        return tx.printTemplate.create({
          data: { organizationId, branchId, docType, paperSize, name, isDefault, layout: layout as Prisma.InputJsonValue },
        });
      }),
    );
  }

  async update(organizationId: string, id: string, user: BranchScopedUser, input: UpdatePrintTemplateInput) {
    const current = await this.get(organizationId, id, user);
    const paperSize = input.paperSize !== undefined ? this.paper(input.paperSize) : (current.paperSize as PaperSize);
    // A new paper size re-checks the old layout against the new page.
    const layout =
      input.layout !== undefined || paperSize !== current.paperSize
        ? validateLayout(input.layout ?? current.layout, paperSize)
        : undefined;
    return this.prisma.$transaction(async (tx) => {
      let isDefault = current.isDefault;
      // Moving a default to a paper size that already has one: the other stays.
      if (isDefault && paperSize !== current.paperSize) {
        const clash = await tx.printTemplate.count({
          where: { branchId: current.branchId, docType: current.docType, paperSize, isDefault: true, id: { not: id } },
        });
        if (clash > 0) isDefault = false;
      }
      return tx.printTemplate.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: this.name(input.name) }),
          paperSize,
          isDefault,
          ...(layout && { layout: layout as Prisma.InputJsonValue }),
        },
      });
    });
  }

  async setDefault(organizationId: string, id: string, user: BranchScopedUser, isDefault: boolean) {
    const current = await this.get(organizationId, id, user);
    return this.withDefaultRetry(() =>
      this.prisma.$transaction(async (tx) => {
        if (isDefault) {
          await this.clearDefault(tx, organizationId, current.branchId, current.docType, current.paperSize);
        }
        return tx.printTemplate.update({ where: { id }, data: { isDefault } });
      }),
    );
  }

  // A copy at the same branch, or (MASTER) at another one.
  async duplicate(organizationId: string, id: string, user: BranchScopedUser, opts: { branchId?: string | null; name?: string }) {
    const source = await this.get(organizationId, id, user);
    return this.create(organizationId, user, {
      docType: source.docType,
      paperSize: source.paperSize,
      layout: source.layout,
      branchId: opts.branchId || source.branchId,
      name: opts.name?.trim() ? opts.name : `${source.name} (copy)`.slice(0, 100),
      isDefault: false,
    });
  }

  async remove(organizationId: string, id: string, user: BranchScopedUser) {
    await this.get(organizationId, id, user);
    await this.prisma.printTemplate.delete({ where: { id } });
    return { ok: true };
  }

  // The design a document prints with. templateId 'builtin' = the app's own
  // fixed layout; an id = that design if it's this business's and for this
  // kind of document; nothing = the document's branch default for the paper
  // size (or, with several sizes allowed, the first size that has one).
  // A missing or unusable choice falls back rather than failing the print.
  async resolve(
    organizationId: string,
    docType: PrintDocType,
    branchId: string | null,
    papers: readonly string[],
    templateId?: string | null,
  ): Promise<ResolvedPrintTemplate | null> {
    if (templateId === 'builtin') return null;
    const select = { id: true, name: true, paperSize: true, layout: true } as const;
    if (templateId) {
      const chosen = await this.prisma.printTemplate.findFirst({
        where: { id: templateId, organizationId, docType },
        select,
      });
      if (chosen) return chosen;
    }
    const branch =
      branchId ??
      (
        await this.prisma.branch.findFirst({
          where: { organizationId, archivedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id;
    if (!branch) return null;
    const defaults = await this.prisma.printTemplate.findMany({
      where: { organizationId, branchId: branch, docType, isDefault: true, paperSize: { in: [...papers] } },
      select,
    });
    for (const paper of papers) {
      const match = defaults.find((d) => d.paperSize === paper);
      if (match) return match;
    }
    return null;
  }

  private async clearDefault(
    tx: Prisma.TransactionClient,
    organizationId: string,
    branchId: string,
    docType: PrintDocType,
    paperSize: string,
  ) {
    await tx.printTemplate.updateMany({
      where: { organizationId, branchId, docType, paperSize, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async withDefaultRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === DEFAULT_CLASH) return run();
      throw e;
    }
  }

  // A restricted member's own branch; MASTER's choice, else the first branch.
  private async branchFor(organizationId: string, user: BranchScopedUser, requested: string | null): Promise<string> {
    const wanted = bookingBranchId(user, requested);
    const branch = await this.prisma.branch.findFirst({
      where: { organizationId, archivedAt: null, ...(wanted ? { id: wanted } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found');
    return branch.id;
  }

  private docType(v: string): PrintDocType {
    if (!(DOC_TYPES as string[]).includes(v)) throw new BadRequestException('Unknown document type');
    return v as PrintDocType;
  }

  private paper(v: string): PaperSize {
    if (!(PAPER_SIZES as readonly string[]).includes(v)) throw new BadRequestException('Unknown paper size');
    return v as PaperSize;
  }

  private name(v: string) {
    const name = (v ?? '').trim().slice(0, 100);
    if (!name) throw new BadRequestException('Give the design a name');
    return name;
  }
}
