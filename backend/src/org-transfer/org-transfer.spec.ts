import 'dotenv/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { InvoiceFormat } from '@prisma/client';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceModule } from '../invoice/invoice.module';
import { InvoiceService } from '../invoice/invoice.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { OrgTransferModule } from './org-transfer.module';
import {
  buildPlan,
  OrgTransferService,
  STRIPPED_FIELDS,
} from './org-transfer.service';

// InvoiceService imports puppeteer (ESM-only) for PDF rendering.
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

type Row = Record<string, unknown>;

// Export a business with real documents in it, remove it, import it back:
// it must come back the same, row for row and file for file.
describe('Organization export / import', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let transfer: OrgTransferService;
  let orgId: string;
  let exported: string;
  const PASSWORD = 'correct horse battery';
  const plan = buildPlan();
  const intModels = new Set(plan.filter((p) => p.intId).map((p) => p.name));

  // Every row of the org, comparable across a re-import: autoincrement ids
  // (and keys pointing at them) are renumbered, and stripped columns aren't
  // carried over, so both are left out.
  async function snapshot(organizationId: string) {
    const out: Record<string, string[]> = {};
    for (const p of plan) {
      const stripped = new Set(STRIPPED_FIELDS[p.name] ?? []);
      const skip = new Set([
        ...stripped,
        ...(p.intId ? ['id'] : []),
        ...p.fks.filter((fk) => intModels.has(fk.target)).map((fk) => fk.field),
      ]);
      const rows = await (
        prisma as unknown as Record<
          string,
          { findMany(a: object): Promise<Row[]> }
        >
      )[p.delegate].findMany({ where: p.scope(organizationId) });
      out[p.name] = rows
        .map((r) =>
          JSON.stringify(
            Object.fromEntries(Object.entries(r).filter(([k]) => !skip.has(k))),
          ),
        )
        .sort();
    }
    return out;
  }

  async function removeOrganization(organizationId: string) {
    await prisma.organizationModule.deleteMany({ where: { organizationId } });
    for (const p of [...plan].reverse()) {
      await (
        prisma as unknown as Record<
          string,
          { deleteMany(a: object): Promise<unknown> }
        >
      )[p.delegate].deleteMany({
        where: p.scope(organizationId),
      });
    }
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR = await fs.mkdtemp(
      join(tmpdir(), 'waresys-transfer-uploads-'),
    );
    module = await Test.createTestingModule({
      imports: [PrismaModule, InvoiceModule, OrgTransferModule],
    }).compile();
    prisma = module.get(PrismaService);
    transfer = module.get(OrgTransferService);
    const invoices = module.get(InvoiceService);

    const logo = `logos/${randomUUID()}.png`;
    await fs.mkdir(join(process.env.UPLOADS_DIR, 'logos'), { recursive: true });
    await fs.writeFile(
      join(process.env.UPLOADS_DIR, ...logo.split('/')),
      'png-bytes',
    );

    orgId = (
      await prisma.organization.create({
        data: {
          name: `Transfer ${randomUUID()}`,
          logoUrl: `/uploads/${logo}`,
          seatLimit: 7,
          plan: 'pro',
        },
      })
    ).id;
    await module.get(ChartOfAccountsSeedService).seedDefaults(orgId);
    await prisma.organizationModule.create({
      data: { organizationId: orgId, module: 'INVOICE_POS', enabled: true },
    });
    const adminId = (
      await prisma.user.create({
        data: {
          email: `transfer-${randomUUID()}@example.com`,
          password: 'hash',
          role: 'ADMIN',
          organizationId: orgId,
          currentSessionId: 'live-session',
        },
      })
    ).id;
    const rack = (
      await prisma.location.create({
        data: { name: 'Rack A', organizationId: orgId },
      })
    ).id;
    const categoryId = (
      await prisma.category.create({
        data: { name: 'General', organizationId: orgId },
      })
    ).id;
    const customerId = (
      await prisma.customer.create({
        data: { name: 'Toko Maju', organizationId: orgId },
      })
    ).id;
    const taxId = (
      await prisma.organizationTaxRate.create({
        data: { organizationId: orgId, name: 'PPN', percentage: 11 },
      })
    ).id;
    for (let i = 0; i < 3; i++) {
      const product = await prisma.product.create({
        data: {
          name: `Part ${i}`,
          sku: `T-${randomUUID().slice(0, 8)}`,
          categoryId,
          organizationId: orgId,
          sellingPrice: 100_000,
          costPrice: 60_000,
        },
      });
      await prisma.stock.create({
        data: {
          productId: product.id,
          locationId: rack,
          organizationId: orgId,
          quantity: 20,
        },
      });
      const draft = await invoices.createDraft(orgId, adminId, {
        locationId: rack,
        format: InvoiceFormat.A4,
        customerId,
        items: [
          {
            productId: product.id,
            locationId: rack,
            quantity: 2,
            taxRateIds: [taxId],
          },
        ],
      });
      await invoices.issue(orgId, draft.id, adminId, 'ADMIN');
    }
  });

  afterAll(async () => {
    if (exported) await fs.rm(exported, { force: true });
    await module?.close();
  });

  it('exports and imports a business unchanged', async () => {
    const before = await snapshot(orgId);
    expect(before.Invoice).toHaveLength(3);
    expect(before.InvoiceItem.length).toBeGreaterThan(0);
    expect(before.JournalEntryLine.length).toBeGreaterThan(0);

    exported = (await transfer.export(orgId, PASSWORD)).file;

    await removeOrganization(orgId);
    const logo = (before.Organization[0] &&
      (JSON.parse(before.Organization[0]) as Row).logoUrl) as string;
    const logoPath = join(
      process.env.UPLOADS_DIR!,
      ...logo.replace('/uploads/', '').split('/'),
    );
    await fs.rm(logoPath);

    const result = await transfer.import(exported, PASSWORD);
    expect(result.organizationId).toBe(orgId);
    expect(result.files).toBe(1);
    expect(await snapshot(orgId)).toEqual(before);
    expect(await fs.readFile(logoPath, 'utf-8')).toBe('png-bytes');

    // What belongs to the source install is not carried over.
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
    });
    expect(org.seatLimit).toBe(1);
    expect(org.plan).toBe('custom');
    expect(
      await prisma.user.findFirst({
        where: { organizationId: orgId, currentSessionId: { not: null } },
      }),
    ).toBeNull();
    expect(
      await prisma.organizationModule.count({
        where: { organizationId: orgId },
      }),
    ).toBe(0);
  });

  it('refuses a business that already exists here', async () => {
    await expect(transfer.import(exported, PASSWORD)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('refuses a wrong password or a changed file, without writing anything', async () => {
    await removeOrganization(orgId);
    await expect(
      transfer.import(exported, 'wrong password!'),
    ).rejects.toBeInstanceOf(BadRequestException);

    const bytes = await fs.readFile(exported);
    bytes[Math.floor(bytes.length / 2)] ^= 1;
    const tampered = `${exported}.tampered.wsexport`;
    await fs.writeFile(tampered, bytes);
    await expect(transfer.import(tampered, PASSWORD)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await fs.rm(tampered);

    expect(await prisma.organization.count({ where: { id: orgId } })).toBe(0);
  });

  it('refuses users whose email is already taken here', async () => {
    const before = await prisma.organization.create({
      data: { name: 'Other' },
    });
    const imported = await transfer.import(exported, PASSWORD);
    const email = (
      await prisma.user.findFirstOrThrow({
        where: { organizationId: imported.organizationId },
      })
    ).email;
    await removeOrganization(imported.organizationId);
    await prisma.user.create({
      data: { email, password: 'x', role: 'ADMIN', organizationId: before.id },
    });

    await expect(transfer.import(exported, PASSWORD)).rejects.toThrow(email);
  });

  it('refuses a short export password', async () => {
    await expect(transfer.export(orgId, 'short')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
