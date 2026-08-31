import { Module } from '@nestjs/common';
import { OrganizationModulesController } from './organization-modules.controller';
import { OrganizationModulesService } from './organization-modules.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationModulesController],
  providers: [OrganizationModulesService],
  exports: [OrganizationModulesService], // <-- add this
})
export class OrganizationModulesModule {}