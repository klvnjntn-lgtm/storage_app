// src/platform/platform.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ModuleKey } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  PlatformActor,
  PlatformOwnerGuard,
  PlatformUnlockNotRequired,
} from './platform-owner.guard';
import { auditContext } from './platform-audit';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformService } from './platform.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import {
  AuditLogQueryDto,
  SetModuleDto,
  SuspendOrganizationDto,
  UnlockConfirmDto,
  UnlockRequestDto,
} from './dto/platform.dto';

type PlatformRequest = Request & { platformActor: PlatformActor };

// The platform owner's console across every customer organization. Who
// may use it, and how, is in PlatformOwnerGuard. @Roles('ADMIN') is
// redundant with the guard but keeps drivers/users out even if the guard
// were ever removed from here.
@Roles('ADMIN')
@UseGuards(PlatformOwnerGuard)
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly platform: PlatformService,
  ) {}

  // --- Unlock (step-up) ---

  @PlatformUnlockNotRequired()
  @Get('session')
  session(@Req() req: PlatformRequest) {
    return this.auth.status(auditContext(req));
  }

  // Each wrong password is audited; the throttle caps guessing per client.
  @Throttle({ default: { limit: 5, ttl: 15 * 60 * 1000 } })
  @PlatformUnlockNotRequired()
  @HttpCode(200)
  @Post('unlock/request')
  requestUnlock(@Req() req: PlatformRequest, @Body() dto: UnlockRequestDto) {
    return this.auth.requestUnlock(auditContext(req), dto.password);
  }

  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @PlatformUnlockNotRequired()
  @HttpCode(200)
  @Post('unlock/confirm')
  confirmUnlock(@Req() req: PlatformRequest, @Body() dto: UnlockConfirmDto) {
    return this.auth.confirmUnlock(auditContext(req), dto.code);
  }

  @PlatformUnlockNotRequired()
  @HttpCode(200)
  @Post('lock')
  lock(@Req() req: PlatformRequest) {
    return this.auth.lock(auditContext(req));
  }

  // --- Organizations ---

  @Get('organizations')
  listOrganizations() {
    return this.platform.listOrganizations();
  }

  @Get('organizations/:id')
  getOrganization(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.getOrganization(id);
  }

  @Patch('organizations/:id')
  updateOrganization(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.platform.updateOrganization(auditContext(req), id, dto);
  }

  @HttpCode(200)
  @Post('organizations/:id/suspend')
  suspend(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendOrganizationDto,
  ) {
    return this.platform.suspend(auditContext(req), id, dto.reason);
  }

  @HttpCode(200)
  @Post('organizations/:id/reactivate')
  reactivate(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.platform.reactivate(auditContext(req), id);
  }

  @Put('organizations/:id/modules/:module')
  setModule(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('module', new ParseEnumPipe(ModuleKey)) module: ModuleKey,
    @Body() dto: SetModuleDto,
  ) {
    return this.platform.setModule(
      auditContext(req),
      id,
      module,
      dto.enabled,
      dto.expiresAt,
    );
  }

  // --- Audit ---

  @Get('audit-log')
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.platform.auditLog(query);
  }
}
