import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingModule } from '../accounting/accounting.module';
import { SupplierBillController } from './supplier-bill.controller';
import { SupplierBillService } from './supplier-bill.service';

@Module({
  imports: [PrismaModule, AccountingModule],
  controllers: [SupplierBillController],
  providers: [SupplierBillService],
})
export class SupplierBillModule {}
