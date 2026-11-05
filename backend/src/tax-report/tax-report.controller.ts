import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { filterBranchId } from '../auth/branch-scope';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TaxReportService } from './tax-report.service';

// Covers every branch unless one is asked for, so MASTER only, like the books.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@Roles('MASTER')
@RequireModule(ModuleKey.ACCOUNTING)
@Controller('tax-report')
export class TaxReportController {
  constructor(private readonly taxReport: TaxReportService) {}

  // lines=true adds each invoice's items, for the Excel download.
  @Get()
  report(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('month') month: string,
    @Query('branchId') branchId?: string,
    @Query('lines') lines?: string,
  ) {
    return this.taxReport.report(organizationId, month ?? '', filterBranchId(req.user, branchId), lines === 'true');
  }
}
