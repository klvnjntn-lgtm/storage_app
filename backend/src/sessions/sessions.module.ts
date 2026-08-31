// src/sessions/sessions.module.ts
import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationModulesModule } from 'src/organization-module/organization-modules.module';

@Module({
  imports: [OrganizationModulesModule], // was in `controllers` — that's for @Controller() classes only, doesn't wire up providers from another module
  controllers: [SessionsController],
  providers: [SessionsService, PrismaService],
  exports: [SessionsService],
})
export class SessionsModule {}