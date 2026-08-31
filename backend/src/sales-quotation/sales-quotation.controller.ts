import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ModuleKey, SalesQuotationStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { SalesQuotationService } from './sales-quotation.service';
import { CreateSalesQuotationDto, UpdateSalesQuotationDto } from './dto/sales-quotation.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Controller('sales-quotations')
export class SalesQuotationController {
  constructor(private quotationService: SalesQuotationService) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateSalesQuotationDto) {
    return this.quotationService.create(organizationId, req.user.sub, dto);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('status') status?: SalesQuotationStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('dateField') dateField?: 'sent' | 'created',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.quotationService.list(organizationId, {
      status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search,
      dateField,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.quotationService.getOne(organizationId, id);
  }

  // NEW — surfaces the audit trail from #1. Without this route there's
  // no way to actually read what logActivity has been writing.
  @Get(':id/activity')
  getActivityHistory(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.quotationService.getActivityHistory(organizationId, id);
  }

  @Patch(':id')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: UpdateSalesQuotationDto,
  ) {
    return this.quotationService.update(organizationId, id, req.user.sub, dto);
  }

  @Post(':id/send')
  send(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.quotationService.send(organizationId, id, req.user.sub);
  }

  @Post(':id/accept')
  accept(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.quotationService.accept(organizationId, id, req.user.sub);
  }

  @Post(':id/reject')
  reject(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body('reason') reason?: string,
  ) {
    return this.quotationService.reject(organizationId, id, req.user.sub, reason);
  }

  // NEW — cancel() exists on the service (#1/#2 in this thread) but had
  // no route. Reason is required at the service level; enforced there,
  // not re-validated here.
  @Post(':id/cancel')
  cancel(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body('reason') reason: string,
  ) {
    return this.quotationService.cancel(organizationId, id, req.user.sub, reason);
  }

  // NEW — discardDraft() existed on the service with no route either.
  // DELETE fits the semantics (draft is being removed) better than a
  // POST :id/discard action route, but either is defensible — pick
  // whichever matches your other draft-delete routes (e.g. does invoice
  // use DELETE for discardDraft? mirror that for consistency).
  @Delete(':id')
  discardDraft(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.quotationService.discardDraft(organizationId, id, req.user.sub);
  }

  // NEW — in-app preview of the print-shaped data, distinct from the raw
  // getOne(). Useful for a "preview before send" screen without minting
  // a print token or leaving the authenticated app.
  @Get(':id/print-view')
  getPrintView(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.quotationService.getPrintView(organizationId, id);
  }

  // NEW — triggers the actual PDF render and streams it back.
  @Get(':id/pdf')
  async getPdf(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.quotationService.renderPdf(organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="quotation-${id}.pdf"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }
}