// bank-account.module.ts
import { Module } from '@nestjs/common';
import { BankAccountController } from './bank-account.controller';
import { BankAccountService } from './bank-account.service';
import { BankAccountResolverService } from './bank-account-resolver.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [BankAccountController],
  providers: [BankAccountService, BankAccountResolverService],
  exports: [BankAccountResolverService], // so Invoice/SalesQuotation modules can inject it
})
export class BankAccountModule {}