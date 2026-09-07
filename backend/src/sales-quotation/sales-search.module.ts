import { Module } from '@nestjs/common';
import { SalesSearchController } from './sales-search.controller';
import { SalesSearchService } from './sales-search.service'
import { PrismaModule } from '../prisma/prisma.module'; // only needed if PrismaModule is NOT @Global()

@Module({
  imports: [PrismaModule], // uncomment if PrismaService isn't globally available
  controllers: [SalesSearchController],
  providers: [SalesSearchService],
})
export class SalesSearchModule {}