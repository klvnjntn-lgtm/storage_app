import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { filterBranchId } from '../auth/branch-scope';
import { PerformanceService } from './performance.service';

// Staff performance is a manager's report: admins (their branch) and MASTER (any or every branch).
@RequireModule(ModuleKey.INVOICE_POS)
@Roles('ADMIN')
@Controller('reports/performance')
export class PerformanceController {
  constructor(private performance: PerformanceService) {}

  @Get()
  report(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    if (!from || !to) throw new BadRequestException('from and to are required (YYYY-MM-DD)');
    return this.performance.report(organizationId, { from, to, branchId: filterBranchId(req.user, branchId) });
  }
}
