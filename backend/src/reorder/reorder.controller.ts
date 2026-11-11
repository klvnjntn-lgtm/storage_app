import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { bookingBranchId, filterBranchId } from '../auth/branch-scope';
import { ReorderService } from './reorder.service';
import {
  AutoFillReorderDto,
  CreateReorderPosDto,
  ImportReorderDto,
  ReorderSettingsDto,
} from './dto/reorder.dto';

// Branches: an ADMIN or USER held to a branch always works in it; MASTER
// picks one with branchId, or leaves it out for the business as a whole.
// A single-branch business is always business-wide (ReorderService.branchFor).
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('reorder')
export class ReorderController {
  constructor(private reorder: ReorderService) {}

  private branch(organizationId: string, req: { user: Parameters<typeof filterBranchId>[0] }, requested?: string) {
    return this.reorder.branchFor(organizationId, filterBranchId(req.user, requested));
  }

  @Get()
  async report(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('all') all?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reorder.report(organizationId, all !== 'true', await this.branch(organizationId, req, branchId));
  }

  @Roles('ADMIN')
  @Get('export')
  async exportRows(@CurrentOrg() organizationId: string, @Req() req, @Query('branchId') branchId?: string) {
    return this.reorder.exportRows(organizationId, await this.branch(organizationId, req, branchId));
  }

  @Roles('ADMIN')
  @Post('import')
  async importRows(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: ImportReorderDto) {
    return this.reorder.importRows(organizationId, dto, await this.branch(organizationId, req, dto.branchId));
  }

  @Roles('ADMIN')
  @Post('auto-fill')
  async autoFill(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: AutoFillReorderDto) {
    return this.reorder.autoFill(organizationId, dto, await this.branch(organizationId, req, dto.branchId));
  }

  @Roles('ADMIN')
  @Get('products/:productId')
  async getSettings(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.reorder.getSettings(organizationId, productId, await this.branch(organizationId, req, branchId));
  }

  @Roles('ADMIN')
  @Patch('products/:productId')
  async settings(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderSettingsDto,
  ) {
    return this.reorder.updateSettings(
      organizationId,
      productId,
      dto,
      await this.branch(organizationId, req, dto.branchId),
    );
  }

  @Post('purchase-orders')
  async createPos(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateReorderPosDto) {
    const branchId = await this.reorder.branchFor(organizationId, bookingBranchId(req.user, dto.branchId));
    return this.reorder.createDraftPurchaseOrders(organizationId, req.user.sub, dto, branchId);
  }
}
