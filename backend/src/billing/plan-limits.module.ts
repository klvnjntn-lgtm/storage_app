import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlanLimitsService } from './plan-limits.service';

// Separate from BillingModule: the limit checks sit in many unrelated
// modules (users, auth, locations, products, invoices), which import just
// this rather than the gateway and checkout code.
@Module({
  imports: [PrismaModule],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class PlanLimitsModule {}
