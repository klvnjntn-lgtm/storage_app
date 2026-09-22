import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { FixedAssetStatus, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FixedAssetsService } from './fixed-assets.service';
import { toBusinessDate, resolveTimezone, todayBusinessDate } from './business-date';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFixedAssetDto,
  DisposeFixedAssetDto,
  RecordFixedAssetPaymentDto,
  RunDepreciationDto,
} from './dto/fixed-asset.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(
    private fixedAssetsService: FixedAssetsService,
    private prisma: PrismaService,
  ) {}

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: FixedAssetStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.fixedAssetsService.list(organizationId, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  get(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.fixedAssetsService.get(organizationId, id);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Body() dto: CreateFixedAssetDto, @Req() req) {
    return this.fixedAssetsService.create(organizationId, dto, req.user.sub);
  }

  @Post(':id/payments')
  recordPayment(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordFixedAssetPaymentDto,
    @Req() req,
  ) {
    return this.fixedAssetsService.recordPayment(organizationId, id, dto, req.user.sub);
  }

  // Disposal is a one-way status transition (ACTIVE -> DISPOSED, see
  // FixedAssetsService.dispose()) — same irreversibility tier as
  // run-depreciation and voidUnrecorded below, which are already
  // ADMIN-gated. create()/recordPayment() stay ungated, matching
  // ExpensesService's routine-recording pattern (ops staff record
  // acquisitions/payments; ADMIN only gates structural/irreversible
  // actions).
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post(':id/dispose')
  dispose(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DisposeFixedAssetDto,
  ) {
    return this.fixedAssetsService.dispose(organizationId, id, dto);
  }

  // Defaults `through` to today in the org's own business timezone, same
  // convention as the report endpoints in accounting.controller.ts use for
  // their own default `asOf`/`to`.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('run-depreciation')
  async runDepreciation(@CurrentOrg() organizationId: string, @Body() dto: RunDepreciationDto) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const tz = resolveTimezone(org);
    const throughDate = dto.through ? toBusinessDate(new Date(dto.through), tz) : todayBusinessDate(tz);
    return this.fixedAssetsService.runDepreciation(organizationId, throughDate);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  voidUnrecorded(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.fixedAssetsService.voidUnrecorded(organizationId, id, req.user.sub, reason);
  }
}
