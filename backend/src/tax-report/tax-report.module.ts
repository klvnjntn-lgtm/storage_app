import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { TaxReportController } from './tax-report.controller';
import { TaxReportService } from './tax-report.service';

@Module({
  imports: [PrismaModule, GuardsModule],
  controllers: [TaxReportController],
  providers: [TaxReportService],
})
export class TaxReportModule {}
