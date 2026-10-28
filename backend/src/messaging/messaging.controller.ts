import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ModuleKey } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import {
  businessDayBounds,
  resolveTimezone,
} from '../accounting/business-date';
import { MessagingService } from './messaging.service';
import {
  MessagingSettingsDto,
  SendDocumentDto,
  SendStatementDto,
  TopupDto,
} from './dto/messaging.dto';
import { BranchRecord } from '../auth/guards/branch-record.guard';

@RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
@Controller('messaging')
export class MessagingController {
  constructor(
    private messaging: MessagingService,
    private prisma: PrismaService,
  ) {}

  // Which send channels this server has switched on (for the send dialog).
  @Get('channels')
  channels() {
    return this.messaging.channels();
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @BranchRecord('invoice')
  @Post('invoices/:id/send')
  sendInvoice(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendDocumentDto,
  ) {
    return this.messaging.sendInvoice(organizationId, user.sub, id, dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @BranchRecord('workOrder')
  @Post('work-orders/:id/ready')
  sendWorkOrderReady(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendDocumentDto,
  ) {
    return this.messaging.sendWorkOrderReady(organizationId, user.sub, id, dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('purchase-orders/:id/send')
  sendPurchaseOrder(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendDocumentDto,
  ) {
    return this.messaging.sendPurchaseOrder(organizationId, user.sub, id, dto);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('statements/send')
  async sendStatement(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendStatementDto,
  ) {
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const bounds = businessDayBounds(
      dto.periodFrom,
      dto.periodTo,
      resolveTimezone(org),
    );
    return this.messaging.sendStatement(
      organizationId,
      user.sub,
      dto.customerId,
      { from: bounds.gte!, to: bounds.lte! },
      dto,
    );
  }

  @Get('log')
  log(
    @CurrentOrg() organizationId: string,
    @Query('documentId') documentId?: string,
  ) {
    return this.messaging.messageLog(organizationId, documentId);
  }

  @Roles('ADMIN')
  @Get('whatsapp')
  whatsapp(@CurrentOrg() organizationId: string) {
    return this.messaging.whatsappOverview(organizationId);
  }

  @Roles('ADMIN')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('whatsapp/topup')
  topup(
    @CurrentOrg() organizationId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: TopupDto,
  ) {
    return this.messaging.createTopup(organizationId, user.sub, dto.amount);
  }

  @Roles('ADMIN')
  @Patch('settings')
  settings(
    @CurrentOrg() organizationId: string,
    @Body() dto: MessagingSettingsDto,
  ) {
    return this.messaging.updateSettings(organizationId, dto);
  }
}
