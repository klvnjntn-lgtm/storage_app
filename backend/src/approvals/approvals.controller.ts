import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApprovalStatus, ModuleKey } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ApprovalsService } from './approvals.service';
import {
  ApprovalSettingsDto,
  DecideApprovalDto,
  RequestApprovalDto,
} from './dto/approvals.dto';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { isAdminRole } from '../auth/roles';
import { filterBranchId } from '../auth/branch-scope';

@Roles('ADMIN', 'USER')
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('approvals')
export class ApprovalsController {
  constructor(private approvals: ApprovalsService) {}

  // Admins see every request; staff see their own.
  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Query('status', new ParseEnumPipe(ApprovalStatus, { optional: true }))
    status?: ApprovalStatus,
  ) {
    return this.approvals.list(organizationId, {
      status,
      requestedById: isAdminRole(user.role) ? undefined : user.sub,
      branchId: filterBranchId(user),
    });
  }

  @Get('settings')
  settings(@CurrentOrg() organizationId: string) {
    return this.approvals.getSettings(organizationId);
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(
    @CurrentOrg() organizationId: string,
    @Body() dto: ApprovalSettingsDto,
  ) {
    return this.approvals.updateSettings(organizationId, dto);
  }

  @Post()
  request(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: RequestApprovalDto,
  ) {
    return this.approvals.request(
      organizationId,
      user.sub,
      dto.documentType,
      dto.documentId,
      dto.note,
      filterBranchId(user),
    );
  }

  @Roles('ADMIN')
  @Post(':id/decide')
  decide(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.approvals.decide(
      organizationId,
      user.sub,
      id,
      dto.approve,
      dto.note,
      filterBranchId(user),
    );
  }

  @Post(':id/cancel')
  cancel(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.approvals.cancel(organizationId, user.sub, id);
  }
}
