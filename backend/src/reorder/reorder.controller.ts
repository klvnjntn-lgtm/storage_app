import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ReorderService } from './reorder.service';
import { CreateReorderPosDto, ReorderSettingsDto } from './dto/reorder.dto';

@RequireModule(ModuleKey.INVOICE_POS)
@Controller('reorder')
export class ReorderController {
  constructor(private reorder: ReorderService) {}

  @Get()
  report(@CurrentOrg() organizationId: string, @Query('all') all?: string) {
    return this.reorder.report(organizationId, all !== 'true');
  }

  @Roles('ADMIN')
  @Patch('products/:productId')
  settings(
    @CurrentOrg() organizationId: string,
    @Param('productId') productId: string,
    @Body() dto: ReorderSettingsDto,
  ) {
    return this.reorder.updateSettings(organizationId, productId, dto);
  }

  @Post('purchase-orders')
  createPos(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateReorderPosDto,
  ) {
    return this.reorder.createDraftPurchaseOrders(
      organizationId,
      user.sub,
      dto,
    );
  }
}
