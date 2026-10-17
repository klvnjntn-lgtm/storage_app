import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductModule } from '../product/product.module'; // adjust path if different
import { AccountingModule } from 'src/accounting/accounting.module';
import { PlanLimitsModule } from '../billing/plan-limits.module';

@Module({
  imports: [PrismaModule, ProductModule, AccountingModule, PlanLimitsModule], // 👈 added ProductModule and AccountingModule
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService], // 👈 IMPORTANT (used by WarehouseService)
})
export class StockModule {}