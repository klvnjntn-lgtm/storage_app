import { Module } from '@nestjs/common';
import { TaxRateController } from './tax-rate.controller';
import { TaxRateService } from './tax-rate.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  controllers: [TaxRateController],
  providers: [TaxRateService],
  imports: [PrismaModule],
})
export class TaxRateModule {
}