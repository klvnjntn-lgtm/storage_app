// payments/payments.controller.ts
import { Body, Controller, Param, Post, UseGuards, Req } from '@nestjs/common';
import { ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PaymentService } from './payment.service';
import { RecordPaymentDto } from './dto/record-payment.dto';

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
}