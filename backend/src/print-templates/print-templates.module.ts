import { Module } from '@nestjs/common';
import { GuardsModule } from '../auth/guards/guards.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrintTemplatesController } from './print-templates.controller';
import { PrintTemplatesService } from './print-templates.service';

@Module({
  imports: [PrismaModule, GuardsModule],
  controllers: [PrintTemplatesController],
  providers: [PrintTemplatesService],
  // Invoice, quotation and work-order printing resolve the design to use.
  exports: [PrintTemplatesService],
})
export class PrintTemplatesModule {}
