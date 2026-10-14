import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  BillingController,
  BillingWebhookController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { PlanLimitsModule } from './plan-limits.module';

@Module({
  imports: [PrismaModule, NotificationsModule, PlanLimitsModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
