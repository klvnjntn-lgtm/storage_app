// src/auth/guards/guards.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ModuleGuard } from './module.guard';

@Module({
  imports: [PrismaModule],
  providers: [ModuleGuard],
  exports: [ModuleGuard],
})
export class GuardsModule {}