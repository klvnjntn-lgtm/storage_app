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
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { Throttle } from '@nestjs/throttler';
import { ModuleKey } from '@prisma/client';
import type { Request, Response } from 'express';
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
import { OrgTransferService } from '../org-transfer/org-transfer.service';
import { TransferPasswordDto } from '../org-transfer/org-transfer.dto';
import {
  requireFile,
  sendExport,
  TransferFileInterceptor,
} from '../org-transfer/transfer-upload';
import { writeAudit } from './platform-audit';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdjustWaBalanceDto,
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
    private readonly transfer: OrgTransferService,
    private readonly prisma: PrismaService,
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
  @Post('organizations/:id/wa-balance')
  adjustWaBalance(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustWaBalanceDto,
  ) {
    return this.platform.adjustWaBalance(auditContext(req), id, dto.amount, dto.note);
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

  // --- Moving a business between installs (web ⇄ desktop) ---

  // A business from a .wsexport (e.g. a desktop customer moving to the
  // web). It arrives with no modules and the default plan/seats: set
  // those here afterwards, as for any customer.
  @HttpCode(200)
  @Post('organizations/import')
  @UseInterceptors(TransferFileInterceptor)
  async importOrganization(
    @Req() req: PlatformRequest,
    @UploadedFile() upload: Express.Multer.File | undefined,
    @Body() dto: TransferPasswordDto,
  ) {
    const file = requireFile(upload);
    try {
      const result = await this.transfer.import(file.path, dto.password);
      await writeAudit(this.prisma, auditContext(req), 'organization.import', {
        organizationId: result.organizationId,
        after: result,
      });
      return result;
    } finally {
      await fs.rm(file.path, { force: true });
    }
  }

  // A customer's business as a .wsexport (e.g. moving them to the desktop
  // app), encrypted with the password given here.
  @HttpCode(200)
  @Post('organizations/:id/export')
  async exportOrganization(
    @Req() req: PlatformRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const exported = await this.transfer.export(id, dto.password);
    await writeAudit(this.prisma, auditContext(req), 'organization.export', {
      organizationId: id,
    });
    return sendExport(res, exported);
  }

  // --- Audit ---

  @Get('audit-log')
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.platform.auditLog(query);
  }
}
