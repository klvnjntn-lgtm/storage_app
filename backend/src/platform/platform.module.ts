// src/platform/platform.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MailerModule } from '../auth/mailer/mailer.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { OrgTransferModule } from '../org-transfer/org-transfer.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformOwnerGuard } from './platform-owner.guard';

@Module({
  imports: [
    PrismaModule,
    MailerModule,
    OrganizationModulesModule,
    OrgTransferModule,
  ],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAuthService, PlatformOwnerGuard],
})
export class PlatformModule {}
