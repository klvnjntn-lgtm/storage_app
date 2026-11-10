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
});
