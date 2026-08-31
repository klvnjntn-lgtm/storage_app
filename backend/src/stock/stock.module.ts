import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductModule } from '../product/product.module'; // adjust path if different

@Module({
  imports: [PrismaModule, ProductModule], // 👈 added ProductModule
  controllers: [StockController],
  providers: [StockService],
  exports: [StockService], // 👈 IMPORTANT (used by WarehouseService)
})
export class StockModule {}