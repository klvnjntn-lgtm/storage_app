import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { DevicesController } from './devices.controller';

// DevicesService itself lives in AuthModule (see auth/devices.service.ts) —
// this module only adds the admin-facing controller on top of it. PrismaModule
// is imported directly because OrgGuard/RolesGuard on the controller need
// PrismaService, which AuthModule doesn't export.
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [DevicesController],
})
export class DevicesModule {}
