import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../auth/mailer/mailer.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BillingModule } from '../billing/billing.module';
import { InvoiceModule } from '../invoice/invoice.module';
import { PurchaseOrderModule } from '../purchase-order/purchase-order.module';
import { StorageModule } from '../storage/storage.module';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Module({
  imports: [
    PrismaModule,
    MailerModule,
    NotificationsModule,
    BillingModule,
    InvoiceModule,
    PurchaseOrderModule,
    StorageModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
