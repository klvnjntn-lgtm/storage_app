// src/organization/organization.module.ts
import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { LOGO_STORAGE } from './storage/logo-storage.interface';
import { LocalLogoStorageService } from './storage/local-logo-storage.service';

@Module({
  imports: [PrismaModule, OrganizationModulesModule],
  controllers: [OrganizationController],
  providers: [
    OrganizationService,
    LocalLogoStorageService,
    { provide: LOGO_STORAGE, useClass: LocalLogoStorageService },
  ],
})
export class OrganizationModule {}