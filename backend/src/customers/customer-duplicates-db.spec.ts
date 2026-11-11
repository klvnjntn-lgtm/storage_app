import 'dotenv/config';
import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import { CustomersModule } from './customers.module';
import { CustomersService } from './customers.service';

describe('Customer duplicates on create and import (database)', () => {
  let module: TestingModule;
  let prisma: PrismaService;
  let customers: CustomersService;
  let orgId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({ imports: [PrismaModule, StorageModule, CustomersModule] }).compile();
    prisma = module.get(PrismaService);
    customers = module.get(CustomersService);
    orgId = (await prisma.organization.create({ data: { name: `Dupes ${randomUUID()}` } })).id;
    await prisma.customer.create({
      data: { organizationId: orgId, name: 'Bumi Indoneisa, PT', address: 'Kawasan Sarana Blok B No. 3' },
    });
  });

  afterAll(async () => {
    await module?.close();
  });

  const conflict = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      if (e instanceof ConflictException) return e.getResponse() as { code: string; matches: { name: string }[] };
      throw e;
    }
    throw new Error('expected a conflict');
  };

  it('refuses an exact copy, even when confirmed', async () => {
    const r = await conflict(
      customers.create(orgId, { name: 'PT Bumi Indoneisa', address: 'kawasan sarana blok b no 3', confirmSimilar: true }),
    );
    expect(r).toMatchObject({ code: 'CUSTOMER_EXISTS', matches: [{ name: 'Bumi Indoneisa, PT' }] });
  });

  it('asks before adding a similar customer, and adds it once confirmed', async () => {
    const r = await conflict(customers.create(orgId, { name: 'Bumi Indoneisa PT', address: 'Batam Centre' }));
    expect(r.code).toBe('SIMILAR_CUSTOMERS');
    const created = await customers.create(orgId, { name: 'Bumi Indoneisa PT', address: 'Batam Centre', confirmSimilar: true });
    expect(created.name).toBe('Bumi Indoneisa PT');
  });

  it('adds an unrelated customer straight away', async () => {
    expect((await customers.create(orgId, { name: 'Sharon Resto' })).name).toBe('Sharon Resto');
  });

  it('skips copies and unconfirmed similar rows on import', async () => {
    const res = await customers.importMany(orgId, [
      { name: 'Bumi Indoneisa PT', address: 'Kawasan Sarana Blok B No 3' }, // exact copy
      { name: 'Bumi Indonesia', address: 'Nagoya' }, // similar, not confirmed
      { name: 'Bumi Indonesia', address: 'Jodoh', confirmSimilar: true }, // similar, confirmed
      { name: 'Warsun Warung' }, // new
      { name: 'warsun warung.' }, // repeat of the row above
    ]);
    expect(res.created).toBe(2);
    expect(res.skipped.map((s) => [s.row, s.reason])).toEqual([
      [0, 'DUPLICATE_EXISTING'],
      [1, 'SIMILAR_NOT_CONFIRMED'],
      [4, 'DUPLICATE_IN_FILE'],
    ]);
  });

  it('lets a branch share its head office’s NPWP once confirmed', async () => {
    await customers.create(orgId, { name: 'Sumber Rejeki Pusat', address: 'Jl. A 1', npwp: '01.234.567.8-901.000' });
    const branch = { name: 'Sumber Rejeki Nagoya', address: 'Nagoya Hill', npwp: '0012345678901000' };
    expect((await conflict(customers.create(orgId, branch))).code).toBe('SIMILAR_CUSTOMERS');
    expect((await customers.create(orgId, { ...branch, confirmSimilar: true })).npwp).toBe(branch.npwp);
  });

  it('saves the same customer only once when two saves arrive together', async () => {
    const results = await Promise.allSettled([
      customers.create(orgId, { name: 'Toko Kembar', address: 'Jl. Sama 5' }),
      customers.create(orgId, { name: 'Toko Kembar', address: 'Jl. Sama 5' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.customer.count({ where: { organizationId: orgId, name: 'Toko Kembar' } })).toBe(1);
  });

  describe('editing', () => {
    it('refuses turning a customer into a copy of another', async () => {
      const a = await customers.create(orgId, { name: 'Kedai Asli', address: 'Jl. Satu 1' });
      const b = await customers.create(orgId, { name: 'Kedai Lain', address: 'Jl. Satu 1' });
      const r = await conflict(customers.update(orgId, b.id, { name: 'Kedai Asli' }));
      expect(r).toMatchObject({ code: 'CUSTOMER_EXISTS', matches: [{ name: a.name }] });
    });

    it('leaves a pair that already matched editable', async () => {
      const data = { organizationId: orgId, name: 'Lama Ganda', address: 'Jl. Tua 9' };
      await prisma.customer.create({ data });
      const twin = await prisma.customer.create({ data });
      // Unrelated edit, and an edit of an identity field that makes no new copy.
      expect((await customers.update(orgId, twin.id, { deliveryNotes: 'ring twice' })).deliveryNotes).toBe('ring twice');
      expect((await customers.update(orgId, twin.id, { phone: '0812 0000 0000' })).phone).toBe('0812 0000 0000');
    });
  });
});
