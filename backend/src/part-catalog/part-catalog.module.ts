import { Module } from '@nestjs/common';
import { PartCatalogService } from './part-catalog.service';
import { PartCatalogController } from './part-catalog.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PartCatalogController],
  providers: [PartCatalogService],
})
export class PartCatalogModule {}
