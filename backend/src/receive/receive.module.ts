// src/receive/receive.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module'; // ← add if missing
import { ReceiveService } from './receive.service';
import { ReceiveController } from './receive.controller';

@Module({
  imports: [PrismaModule], // ← add if missing
  controllers: [ReceiveController],
  providers: [ReceiveService],
    exports: [ReceiveService], // ← add if missing

})
export class ReceiveModule {}