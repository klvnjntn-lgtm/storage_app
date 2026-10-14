import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { DocumentType, ModuleKey } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentNumberingService } from '../shared/documents/document-numbering.service';
import { UpdateInvoiceNumberingDto } from './dto/invoice-numbering.dto';

// Settings → Invoice numbering. Its own path rather than under
// /invoices so it can't collide with the /invoices/:id routes.
@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard, RolesGuard)
@RequireModule(ModuleKey.INVOICE_POS)
@Roles('ADMIN')
@Controller('invoice-numbering')
export class InvoiceNumberingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: DocumentNumberingService,
  ) {}

  @Get()
  get(@CurrentOrg() orgId: string) {
    return this.numbering.getConfig(orgId, DocumentType.INVOICE, 'INV', this.prisma);
  }

  @Put()
  async update(@CurrentOrg() orgId: string, @Body() body: UpdateInvoiceNumberingDto) {
    // Same transaction as the read, so a concurrent issue can't slip a
    // number in between the forward-only check and the write.
    await this.prisma.$transaction((tx) =>
      this.numbering.setConfig(orgId, DocumentType.INVOICE, body, tx),
    );
    return this.numbering.getConfig(orgId, DocumentType.INVOICE, 'INV', this.prisma);
  }
}
