import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PriceLevelController } from './price-level.controller';
import { PriceLevelService } from './price-level.service';

@Module({
  controllers: [PriceLevelController],
  providers: [PriceLevelService],
  imports: [PrismaModule],
})
export class PriceLevelModule {}
