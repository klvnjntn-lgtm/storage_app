import { Module } from '@nestjs/common';
import { PlanLimitsModule } from '../billing/plan-limits.module';
import { ProductService } from './product.service';
import { ProductController } from './product.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, PlanLimitsModule],
  controllers: [ProductController],
  providers: [ProductService],
  exports: [ProductService], // 👈 added — StockModule needs this to inject ProductService
})
export class ProductModule {}