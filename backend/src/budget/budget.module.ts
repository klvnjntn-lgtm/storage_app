import { Module } from '@nestjs/common';
import { GuardsModule } from '../auth/guards/guards.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BudgetController } from './budget.controller';
import { BudgetService } from './budget.service';

@Module({
  imports: [PrismaModule, GuardsModule],
  controllers: [BudgetController],
  providers: [BudgetService],
})
export class BudgetModule {}
