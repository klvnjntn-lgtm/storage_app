import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PurchaseOrderModule } from '../purchase-order/purchase-order.module';
import { ReorderController } from './reorder.controller';
import { ReorderService } from './reorder.service';

@Module({
  imports: [PrismaModule, NotificationsModule, PurchaseOrderModule],
  controllers: [ReorderController],
  providers: [ReorderService],
  exports: [ReorderService],
})
export class ReorderModule {}
