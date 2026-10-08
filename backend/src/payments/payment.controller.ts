// payments/payments.controller.ts
import { Body, Controller, Delete, Get, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PaymentService } from './payment.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { ApplyCreditDto } from './dto/apply-credit.dto';

// Gated to INVOICE_POS OR WORKSHOP_RMS, same as CustomersController —
// WORKSHOP_RMS depends on INVOICE_POS being active, so any org that
// has WORKSHOP_RMS necessarily has INVOICE_POS too. Listing both here
// (rather than relying on that transitive guarantee) keeps the intent
// self-documenting and doesn't silently break if that dependency rule
// is ever relaxed.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS, ModuleKey.WORKSHOP_RMS)
@Controller('invoices/:invoiceId/payments')
export class PaymentController {
  constructor(private payments: PaymentService) {}

  @Post()
  record(
    @CurrentOrg() organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: RecordPaymentDto,
    @Req() req,
  ) {
    return this.payments.recordPayment(organizationId, invoiceId, dto, req.user?.sub);
  }

  // Customer credit held on this invoice, credit the customer holds on
  // other invoices, and their invoices that still have money owed.
  @Get('credit')
  credit(@CurrentOrg() organizationId: string, @Param('invoiceId') invoiceId: string) {
    return this.payments.getCreditInfo(organizationId, invoiceId);
  }

  // Pays the customer's credit on this invoice back to them. Money leaves
  // the business, so admin-only like voids.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('refund')
  refund(
    @CurrentOrg() organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: RecordPaymentDto,
    @Req() req,
  ) {
    return this.payments.refund(organizationId, invoiceId, dto, req.user?.sub);
  }

  // Pays this invoice from credit the same customer holds on another one.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('apply-credit')
  applyCredit(
    @CurrentOrg() organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: ApplyCreditDto,
    @Req() req,
  ) {
    return this.payments.applyCredit(organizationId, invoiceId, dto, req.user?.sub);
  }

  // FIX — reverses a mistaken/duplicate payment.
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':paymentId')
  void(
    @CurrentOrg() organizationId: string,
    @Param('invoiceId') invoiceId: string,
    @Param('paymentId') paymentId: string,
    @Body('reason') reason: string | undefined,
    @Req() req,
  ) {
    return this.payments.voidPayment(organizationId, invoiceId, paymentId, req.user?.sub, reason);
  }
}