import 'dotenv/config';
import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PrintTemplatesModule } from './print-templates.module';
import { PrintTemplatesService } from './print-templates.service';
import { validateLayout } from './layout-validator';

const layout = (extra: Record<string, unknown> = {}) => ({
  page: { margins: { top: 10, right: 10, bottom: 10, left: 10 } },
  bands: {
    header: {
      height: 40,
      elements: [{ id: 'a', type: 'text', x: 0, y: 0, w: 80, h: 8, text: '{business.name}' }],
    },
  },
  table: { columns: [{ key: 'name', label: 'Barang' }, { key: 'total', label: 'Jumlah', width: 30, align: 'right' }] },
  ...extra,
});

describe('Print templates', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let service: PrintTemplatesService;
  let orgId: string;
  let branchA: string;
  let branchB: string;
  const master = { role: 'MASTER', branchId: null };
  let adminA: { role: string; branchId: string };

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, PrintTemplatesModule] }).compile();
    prisma = module.get(PrismaService);
    service = module.get(PrintTemplatesService);
    orgId = (await prisma.organization.create({ data: { name: `Print ${randomUUID()}` } })).id;
    branchA = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Pusat' } })).id;
    branchB = (await prisma.branch.create({ data: { organizationId: orgId, name: 'Cabang' } })).id;
    adminA = { role: 'ADMIN', branchId: branchA };
  });

  afterAll(async () => {
    await prisma.printTemplate.deleteMany({ where: { organizationId: orgId } });
    await module?.close();
  });

  it('cleans a layout: drops unknown keys, clamps numbers, refuses foreign images', () => {
    const clean = validateLayout(
      layout({
        evil: '<script>',
        bands: {
          header: {
            height: 9999,
            elements: [
              { id: 'x', type: 'image', x: 0, y: 0, w: 20, h: 20, src: 'https://evil.example/a.png', onload: 'x' },
              { id: 'y', type: 'image', x: 0, y: 0, w: 20, h: 20, src: '/uploads/../../etc/passwd' },
              { id: 'z', type: 'image', x: 0, y: 0, w: 20, h: 20, src: '/uploads/org/stamp.png' },
              { id: 't', type: 'text', x: 0, y: 0, w: 20, h: 5, text: 'Hi', color: 'red;background:url(x)' },
            ],
          },
        },
      }),
      'A5',
    );
    expect(clean).not.toHaveProperty('evil');
    expect(clean.bands.header.height).toBe(148);
    const [a, b, c, t] = clean.bands.header.elements as any[];
    expect(a.src).toBe('logo');
    expect(a).not.toHaveProperty('onload');
    expect(b.src).toBe('logo');
    expect(c.src).toBe('/uploads/org/stamp.png');
    expect(t.color).toBe('#000000');
    expect(() => validateLayout(layout({ table: { columns: [] } }), 'A4')).toThrow(BadRequestException);
  });

  it('makes the first design of a kind the default, and keeps one default per paper size', async () => {
    const first = await service.create(orgId, adminA, { docType: 'INVOICE', name: 'Utama', paperSize: 'A4', layout: layout() });
    expect(first.isDefault).toBe(true);
    expect(first.branchId).toBe(branchA);
    const second = await service.create(orgId, adminA, { docType: 'INVOICE', name: 'Cap', paperSize: 'A4', layout: layout() });
    expect(second.isDefault).toBe(false);
    const half = await service.create(orgId, adminA, { docType: 'INVOICE', name: 'Setengah', paperSize: 'A5', layout: layout() });
    expect(half.isDefault).toBe(true);

    await service.setDefault(orgId, second.id, adminA, true);
    const defaults = await prisma.printTemplate.findMany({
      where: { organizationId: orgId, branchId: branchA, docType: 'INVOICE', isDefault: true },
    });
    expect(defaults.map((d) => d.id).sort()).toEqual([second.id, half.id].sort());

    // Moving the A4 default onto A5, which has its own: it stops being default.
    const moved = await service.update(orgId, second.id, adminA, { paperSize: 'A5' });
    expect(moved.isDefault).toBe(false);
  });

  it('resolves the picked design, else the branch default for the paper, else the built-in layout', async () => {
    const a4 = await prisma.printTemplate.findFirstOrThrow({
      where: { organizationId: orgId, branchId: branchA, docType: 'INVOICE', paperSize: 'A4' },
      orderBy: { createdAt: 'asc' },
    });
    await service.setDefault(orgId, a4.id, adminA, true);
    expect((await service.resolve(orgId, 'INVOICE', branchA, ['A4']))?.id).toBe(a4.id);
    expect(await service.resolve(orgId, 'INVOICE', branchA, ['A4'], 'builtin')).toBeNull();
    expect(await service.resolve(orgId, 'INVOICE', branchB, ['A4'])).toBeNull();
    expect(await service.resolve(orgId, 'QUOTATION', branchA, ['A4'])).toBeNull();
    // A design of another kind of document isn't used, even by id.
    expect((await service.resolve(orgId, 'QUOTATION', branchA, ['A4'], a4.id))).toBeNull();
    // No branch on an old document: the business's first branch.
    expect((await service.resolve(orgId, 'INVOICE', null, ['A4']))?.id).toBe(a4.id);
  });

  it('holds a branch admin to their own branch; MASTER copies between branches', async () => {
    await expect(
      service.create(orgId, adminA, { docType: 'QUOTATION', name: 'X', paperSize: 'A4', layout: layout(), branchId: branchB }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const atB = await service.create(orgId, master, { docType: 'QUOTATION', name: 'B', paperSize: 'A4', layout: layout(), branchId: branchB });
    await expect(service.get(orgId, atB.id, adminA)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(orgId, atB.id, adminA)).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.list(orgId, adminA, {})).every((t) => t.branchId === branchA)).toBe(true);

    const copy = await service.duplicate(orgId, atB.id, master, { branchId: branchA });
    expect(copy.branchId).toBe(branchA);
    expect(copy.name).toBe('B (copy)');
    // A copy never takes over as the default.
    expect(copy.isDefault).toBe(false);
  });
});
