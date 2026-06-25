import { Module } from '@nestjs/common';
import { ReceiveService } from './receive.service';
import { ReceiveController } from './receive.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [ReceiveController],
  providers: [ReceiveService, PrismaService],
  exports: [ReceiveService],
})
export class ReceiveModule {}