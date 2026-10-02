import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, Res, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DeliveryOrderStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { DeliveryOrderService } from './delivery-order.service';
import { CreateDeliveryOrderDto } from './dto/delivery-order.dto';
import { RecordDeliveryOrderReturnDto } from './dto/delivery-order-return.dto';
import { RecordDeliveryOrderProofDto } from './dto/delivery-order-proof.dto'; // adjust path/name to your actual DTO
import { RecordDeliveryOrderFailureDto } from './dto/delivery-order-failure.dto';
import { SetDeliveryOrderDestinationDto } from './dto/delivery-order-destination.dto';
import { UpdateDeliveryOrderDetailsDto } from './dto/delivery-order-details.dto';
import { ApplyDeliveryOrderAddressDto } from './dto/delivery-order-address.dto';
import { RescheduleDeliveryOrderDto } from './dto/delivery-order-reschedule.dto';
import type { Response } from 'express';
import { DeliveryProofService } from './delivery-proof.service';

// Staff-only by default. There's no global DRIVER restriction, so without
// this class-level @Roles a DRIVER JWT could list, ship, cancel, return or
// reschedule any delivery order in the org. The two driver-facing actions
// (proof-of-delivery, failure) override it below, and the service then
// scopes those to DOs on the driver's own routes.
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles('ADMIN', 'USER')
@Controller('delivery-orders')
export class DeliveryOrderController {
  constructor(
    private deliveryOrderService: DeliveryOrderService,
    private deliveryProofService: DeliveryProofService,
  ) {}

  @Post()
  create(@CurrentOrg() organizationId: string, @Req() req, @Body() dto: CreateDeliveryOrderDto) {
    return this.deliveryOrderService.create(organizationId, req.user.sub, dto);
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('status') status?: DeliveryOrderStatus,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.deliveryOrderService.list(organizationId, {
      salesOrderId, status,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id')
  getOne(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.deliveryOrderService.getOne(organizationId, id);
  }

  // Authenticated JSON print view — the browser fetches this to render
  // <DeliveryOrderA4Template> client-side. Distinct from the unguarded
  // print/delivery-orders/:id controller (Puppeteer, token-authed) and
  // from :id/pdf below (binary download).
  @Get(':id/print')
  getPrintView(@CurrentOrg() organizationId: string, @Param('id') id: string) {
    return this.deliveryOrderService.getPrintView(organizationId, id);
  }

  @Get(':id/pdf')
  async downloadPdf(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const pdf = await this.deliveryOrderService.renderPdf(organizationId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="delivery-order.pdf"',
    });
    res.send(pdf);
  }

  @Post(':id/ship')
  ship(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.ship(organizationId, id, req.user.sub);
  }

  // Was implemented on the service but never wired up — the frontend's
  // "Save signature" button was 404ing the same way print was.
  @Patch(':id/proof-of-delivery')
  @Roles('ADMIN', 'USER', 'DRIVER')
  recordProofOfDelivery(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RecordDeliveryOrderProofDto,
  ) {
    return this.deliveryOrderService.recordProofOfDelivery(
      organizationId,
      id,
      {
        deliveredBy: dto.deliveredBy,
        receivedBy: dto.receivedBy,
        signedAt: dto.signedAt ? new Date(dto.signedAt) : undefined,
        completedLatitude: dto.completedLatitude,
        completedLongitude: dto.completedLongitude,
        completedAccuracy: dto.completedAccuracy,
      },
      req.user,
    );
  }

  // Private proof photo — stored outside the media library and viewable
  // only through a short-lived signed link (see DeliveryProofService).
  @Post(':id/proof-photo')
  @Roles('ADMIN', 'USER', 'DRIVER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadProofPhoto(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.deliveryProofService.uploadPhoto(organizationId, id, file, req.user);
  }

  @Get(':id/proof-photo-link')
  @Roles('ADMIN', 'USER', 'DRIVER')
  proofPhotoLink(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
  ) {
    return this.deliveryProofService.photoLink(organizationId, id, req.user);
  }

  @Post(':id/failure')
  @Roles('ADMIN', 'USER', 'DRIVER')
  recordFailedDelivery(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RecordDeliveryOrderFailureDto,
  ) {
    return this.deliveryOrderService.recordFailedDelivery(
      organizationId,
      id,
      {
        reason: dto.reason,
        latitude: dto.latitude,
        longitude: dto.longitude,
        failedAt: dto.failedAt ? new Date(dto.failedAt) : undefined,
      },
      req.user,
    );
  }

  @Patch(':id/destination')
  setDestination(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: SetDeliveryOrderDestinationDto,
  ) {
    return this.deliveryOrderService.setDestination(organizationId, id, {
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
  }

  @Patch(':id/address')
  applyAddress(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: ApplyDeliveryOrderAddressDto,
  ) {
    return this.deliveryOrderService.applyAddress(organizationId, id, dto.customerAddressId);
  }

  @Patch(':id/details')
  updateDetails(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryOrderDetailsDto,
  ) {
    return this.deliveryOrderService.updateDetails(organizationId, id, {
      priority: dto.priority,
      deliveryWindowStart: dto.deliveryWindowStart ? new Date(dto.deliveryWindowStart) : undefined,
      deliveryWindowEnd: dto.deliveryWindowEnd ? new Date(dto.deliveryWindowEnd) : undefined,
    });
  }

  @Post(':id/reschedule')
  reschedule(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RescheduleDeliveryOrderDto,
  ) {
    return this.deliveryOrderService.rescheduleDelivery(organizationId, id, {
      routeId: dto.routeId,
      deliveryWindowStart: dto.deliveryWindowStart ? new Date(dto.deliveryWindowStart) : undefined,
      deliveryWindowEnd: dto.deliveryWindowEnd ? new Date(dto.deliveryWindowEnd) : undefined,
    }, req.user.sub);
  }

  @Post(':id/return')
  recordReturn(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: RecordDeliveryOrderReturnDto,
  ) {
    return this.deliveryOrderService.recordReturn(organizationId, id, req.user.sub, dto.items, dto.reason);
  }

  @Post(':id/cancel')
  cancel(@CurrentOrg() organizationId: string, @Param('id') id: string, @Req() req) {
    return this.deliveryOrderService.cancel(organizationId, id, req.user.sub);
  }

  @Post('from-invoice/:invoiceId')
  createFromInvoice(@CurrentOrg() organizationId: string, @Param('invoiceId') invoiceId: string, @Req() req) {
    return this.deliveryOrderService.createFromInvoice(organizationId, req.user.sub, invoiceId);
  }
}