import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LicenseModule } from '../license/license.module';
import { OrgTransferController } from './org-transfer.controller';
import { OrgTransferService } from './org-transfer.service';

@Module({
  imports: [PrismaModule, LicenseModule],
  controllers: [OrgTransferController],
  providers: [OrgTransferService],
  exports: [OrgTransferService],
})
export class OrgTransferModule {}
