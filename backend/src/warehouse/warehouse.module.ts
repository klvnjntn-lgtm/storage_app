// src/warehouse/warehouse.module.ts
import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReceiveModule } from '../receive/receive.module';
import { GuardsModule } from '../auth/guards/guards.module';

@Module({
  imports: [PrismaModule, ReceiveModule, GuardsModule],
  controllers: [WarehouseController],
  providers: [WarehouseService],
})
export class WarehouseModule {}