import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { GuardsModule } from '../auth/guards/guards.module';
import { TaxExportController } from './tax-export.controller';
import { TaxExportService } from './tax-export.service';

@Module({
  imports: [PrismaModule, GuardsModule],
  controllers: [TaxExportController],
  providers: [TaxExportService],
})
export class TaxExportModule {}
