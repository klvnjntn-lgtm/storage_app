// src/organization-modules/organization-modules.controller.ts
import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Post, UseGuards, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ModuleKey } from '@prisma/client';
import { OrganizationModulesService } from './organization-modules.service';
import { EnableModuleDto } from './dto/enable-module.dto';
import { AdminKeyGuard } from '../auth/guards/admin-key.guard';
import { Public } from '../auth/decorators/public.decorator';

@Controller('organizations')
export class OrganizationModulesController {
  constructor(private moduleService: OrganizationModulesService) {}

  @Get('modules')
  getMyModules(@Req() req) {
    return this.moduleService.getEnabledModules(req.user.organizationId);
  }

  @Get('modules/status')
  getMyModuleStatuses(@Req() req) {
    return this.moduleService.getModuleStatuses(req.user.organizationId);
  }

  // --- Admin-only: granting/revoking a module for any org (billing/sales) ---
  // Throttled: these are gated only by a static shared secret, so
  // brute-force attempts should be rate-limited independent of the
  // constant-time comparison in AdminKeyGuard.
  // Route param renamed orgId -> organizationId for consistency; this
  // is just the internal placeholder name in the route pattern, it
  // does not change the actual URL clients call.

  @Public()
  @UseGuards(AdminKeyGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post(':organizationId/modules')
  enableModule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() dto: EnableModuleDto,
  ) {
    return this.moduleService.enableModule(
      organizationId,
      dto.module,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
  }

  @Public()
  @UseGuards(AdminKeyGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Delete(':organizationId/modules/:module')
  disableModule(
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('module', new ParseEnumPipe(ModuleKey)) module: ModuleKey,
  ) {
    return this.moduleService.disableModule(organizationId, module);
  }
}