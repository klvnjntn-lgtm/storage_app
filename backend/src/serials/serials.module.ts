import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SerialsController } from './serials.controller';
import { SerialsService } from './serials.service';

@Module({
  imports: [PrismaModule],
  controllers: [SerialsController],
  providers: [SerialsService],
})
export class SerialsModule {}
