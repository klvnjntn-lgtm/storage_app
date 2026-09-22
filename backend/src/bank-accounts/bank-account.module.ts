// bank-account.module.ts
import { Module } from '@nestjs/common';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import { BankAccountResolverService } from './bank-account-resolver.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccountingModule } from 'src/accounting/accounting.module';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [BankAccountController],
  providers: [BankAccountService, BankAccountResolverService],
  exports: [BankAccountResolverService], // so Invoice/SalesQuotation modules can inject it
})
export class BankAccountModule {}