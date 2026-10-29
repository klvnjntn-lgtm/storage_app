import 'dotenv/config';
import { randomUUID } from 'crypto';
import { SystemAccountKey } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BankAccountGLLinkService } from '../accounting/bank-account-gl-link.service';
import { ChartOfAccountsSeedService } from '../accounting/chart-of-accounts-seed.service';
import { ChartOfAccountsService } from '../accounting/chart-of-accounts.service';
import { BankAccountService } from './bank-account.service';

// A bank account and its ledger account under 1010 Bank stay one thing: renamed, archived and restored
// together, and the Chart of Accounts can't make or change a bank's ledger account on its own.
// Against the isolated test DB.
describe('Bank accounts and their ledger accounts', () => {
  const prisma = new PrismaService();
  const banks = new BankAccountService(prisma, new BankAccountGLLinkService(prisma));
  const chart = new ChartOfAccountsService(prisma);
  let orgId: string;

  const ledgerOf = (bankAccountId: string) =>
    prisma.chartOfAccount.findUniqueOrThrow({ where: { bankAccountId } });

  beforeAll(async () => {
    orgId = (await prisma.organization.create({ data: { name: `Bank ${randomUUID().slice(0, 6)}` } })).id;
    await new ChartOfAccountsSeedService(prisma).seedDefaults(orgId);
  });

  afterAll(() => prisma.$disconnect());

  it('renames, archives and restores the ledger account with its bank account', async () => {
    const bank = await banks.create(orgId, { bankName: 'BCA', accountNumber: '1234567890', accountName: 'Toko' });
    expect((await ledgerOf(bank.id)).name).toBe('BCA •••7890');

    await banks.update(orgId, bank.id, { bankName: 'Mandiri', accountNumber: '5550001111' });
    expect((await ledgerOf(bank.id)).name).toBe('Mandiri •••1111');

    await banks.archive(orgId, bank.id);
    expect((await ledgerOf(bank.id)).isActive).toBe(false);

    await banks.restore(orgId, bank.id);
    expect((await ledgerOf(bank.id)).isActive).toBe(true);
  });

  it("won't let the Chart of Accounts rename or archive a bank's ledger account", async () => {
    const bank = await banks.create(orgId, { bankName: 'BRI', accountNumber: '9876', accountName: 'Toko' });
    const ledger = await ledgerOf(bank.id);
    await expect(chart.update(orgId, ledger.id, { name: 'Other' })).rejects.toThrow('belongs to a bank account');
    await expect(chart.update(orgId, ledger.id, { isActive: false })).rejects.toThrow('belongs to a bank account');
  });

  it('refuses a hand-made account under Bank', async () => {
    const bankParent = await prisma.chartOfAccount.findUniqueOrThrow({
      where: { organizationId_systemKey: { organizationId: orgId, systemKey: SystemAccountKey.BANK } },
    });
    await expect(
      chart.create(orgId, {
        code: '1010.9',
        name: 'Hand-made bank',
        type: bankParent.type,
        normalBalance: bankParent.normalBalance,
        parentId: bankParent.id,
      }),
    ).rejects.toThrow('Add a bank through');
  });
});
