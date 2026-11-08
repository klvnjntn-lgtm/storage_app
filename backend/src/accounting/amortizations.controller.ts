import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BranchRecord } from '../auth/guards/branch-record.guard';
import { bookingBranchId, filterBranchId } from '../auth/branch-scope';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOnly, resolveTimezone, todayBusinessDate } from './business-date';
import { AmortizationsService } from './amortizations.service';
import {
  AmortizationPaymentDto,
  CreateAmortizationDto,
  ListAmortizationsQuery,
  RunAmortizationDto,
  UpdateAmortizationDto,
  WriteOffAmortizationDto,
} from './dto/amortization.dto';

// Amortisasi: intangible assets and prepaid expenses spread over the months they benefit.
// Admin-only like fixed assets; a branch ADMIN sees and books their own branch's.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.ACCOUNTING)
@Roles('ADMIN')
@BranchRecord('amortization')
@Controller('amortizations')
export class AmortizationsController {
  constructor(
    private amortizations: AmortizationsService,
    private prisma: PrismaService,
  ) {}

  private async today(organizationId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    return todayBusinessDate(resolveTimezone(org));
  }

  @Get()
  list(@CurrentOrg() organizationId: string, @Req() req, @Query() query: ListAmortizationsQuery, @Query('branchId') branchId?: string) {
    return this.amortizations.list(organizationId, {
      status: query.status,
      kind: query.kind,
      branchId: filterBranchId(req.user, branchId),
    });
  }

  @Get(':id')
  get(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.amortizations.get(organizationId, id);
  }

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateAmortizationDto) {
    return this.amortizations.create(organizationId, { ...dto, branchId: bookingBranchId(req.user, dto.branchId) }, req.user.sub);
  }

  // Posts every month due across all branches at once, so MASTER only — same as depreciation.
  // Declared before ':id' routes so "run" isn't read as an id.
  @UseGuards(RolesGuard)
  @Roles('MASTER')
  @Post('run')
  async run(@CurrentOrg() organizationId: string, @Body() dto: RunAmortizationDto) {
    const through = dto.through ? parseDateOnly(dto.through, 'through') : await this.today(organizationId);
    return this.amortizations.runAmortization(organizationId, through);
  }

  @Patch(':id')
  update(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAmortizationDto) {
    return this.amortizations.update(organizationId, id, dto);
  }

  @Post(':id/payments')
  pay(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body() dto: AmortizationPaymentDto,
  ) {
    return this.amortizations.recordPayment(organizationId, id, dto, req.user.sub);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post(':id/write-off')
  async writeOff(@CurrentOrg() organizationId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WriteOffAmortizationDto) {
    const date = dto.date ? parseDateOnly(dto.date, 'date') : await this.today(organizationId);
    return this.amortizations.writeOff(organizationId, id, date);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @CurrentOrg() organizationId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.amortizations.remove(organizationId, id, req.user.sub, reason);
  }
}
