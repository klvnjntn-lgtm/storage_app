import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { SharedDocumentsModule } from '../shared/documents/shared-documents.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkOrdersController } from './work-orders.controller';
import { PublicEstimateController } from './public-estimate.controller';
import { WorkOrdersService } from './work-orders.service';

@Module({
  imports: [PrismaModule, GuardsModule, SharedDocumentsModule, InvoiceModule, NotificationsModule],
  controllers: [WorkOrdersController, PublicEstimateController],
  providers: [WorkOrdersService],
})
export class WorkOrdersModule {}
