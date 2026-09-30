// src/delivery-routes/delivery-routes.controller.ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ModuleKey, RouteStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrgGuard } from '../auth/guards/org.guard';
import { ModuleGuard } from '../auth/guards/module.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RequireModule } from '../auth/decorators/require-module.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentOrg } from '../auth/decorators/current-org.decorator';
import { DeliveryRoutesService } from './delivery-routes.service';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
import { AddRouteStopDto } from './dto/add-route-stop.dto';
import { ReorderRouteStopsDto } from './dto/reorder-route-stops.dto';
import { SetRouteStartDto } from './dto/set-route-start.dto';
import { OptimizeRouteDto } from './dto/optimize-route.dto';
import { RoutePlannerService } from './route-planner.service';
import { StopProofService } from './stop-proof.service';
import {
  RecordCustomerStopFailureDto,
  RecordCustomerStopProofDto,
  RescheduleCustomerStopDto,
  UpdateCustomerStopDetailsDto,
} from './dto/customer-stop-actions.dto';
import { MAX_PHOTO_UPLOAD_BYTES } from '../storage/private-photo';
import {
  ApplyRoutePlanDto,
  PlanCandidatesQueryDto,
  PlanRoutesDto,
} from './dto/plan-routes.dto';

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.DELIVERY_DMS)
@Controller('delivery-routes')
export class DeliveryRoutesController {
  constructor(
    private readonly deliveryRoutesService: DeliveryRoutesService,
    private readonly routePlanner: RoutePlannerService,
    private readonly stopProof: StopProofService,
  ) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  create(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Body() dto: CreateRouteDto,
  ) {
    return this.deliveryRoutesService.createRoute(
      organizationId,
      req.user.sub,
      dto,
    );
  }

  @Get()
  list(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('teamId') teamId?: string,
    @Query('date') date?: string,
    @Query('status') status?: RouteStatus,
  ) {
    return this.deliveryRoutesService.listRoutes(
      organizationId,
      { teamId, date, status },
      req.user,
    );
  }

  // Driver's own routes — MUST stay declared above the :id routes below,
  // same reasoning as VehiclesController's /vehicles/search: a static
  // segment placed after :id would be swallowed as an id param instead.
  @Get('mine')
  @UseGuards(RolesGuard)
  @Roles('DRIVER')
  mine(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.listMyRoutes(
      organizationId,
      req.user.sub,
      date,
    );
  }

  @Get('monitoring/summary')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  monitoringSummary(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringSummary(organizationId, date);
  }

  @Get('monitoring/teams')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  monitoringByTeam(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringByTeam(organizationId, date);
  }

  @Get('monitoring/map')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  monitoringMap(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringMap(organizationId, date);
  }

  // Static segment — MUST stay above the :id routes below, same reasoning
  // as 'mine' and 'monitoring/*'.
  @Get('drivers')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  listDrivers(@CurrentOrg() organizationId: string) {
    return this.deliveryRoutesService.listDrivers(organizationId);
  }

  // ─── Optimize all teams (VROOM) ────────────────────────────────────
  @Get('plan/candidates')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  planCandidates(
    @CurrentOrg() organizationId: string,
    @Query() query: PlanCandidatesQueryDto,
  ) {
    return this.routePlanner.candidates(organizationId, query.routeDate);
  }

  @Post('plan/preview')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  planPreview(
    @CurrentOrg() organizationId: string,
    @Body() dto: PlanRoutesDto,
  ) {
    return this.routePlanner.preview(organizationId, dto);
  }

  @Post('plan')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  planApply(
    @CurrentOrg() organizationId: string,
    @Req() req,
    @Body() dto: ApplyRoutePlanDto,
  ) {
    return this.routePlanner.apply(organizationId, req.user.sub, dto);
  }

  @Get(':id')
  getOne(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
  ) {
    return this.deliveryRoutesService.getRoute(organizationId, id, req.user);
  }

  @Get(':id/history')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  getHistory(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
  ) {
    return this.deliveryRoutesService.getHistory(organizationId, routeId);
  }

  // Route-mutation endpoints (and create, monitoring, drivers, history
  // above) are ADMIN/USER-only — a DRIVER may view their
  // own routes (see 'mine' above) but must not be able to reorder, add,
  // remove, optimize, or otherwise change routes, including ones assigned
  // to other drivers.
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  update(
    @CurrentOrg() organizationId: string,
    @Param('id') id: string,
    @Req() req,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.deliveryRoutesService.updateRoute(
      organizationId,
      id,
      dto,
      req.user.sub,
    );
  }

  @Patch(':id/start')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  setStart(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Req() req,
    @Body() dto: SetRouteStartDto,
  ) {
    return this.deliveryRoutesService.setStart(
      organizationId,
      routeId,
      dto,
      req.user.sub,
    );
  }

  @Post(':id/optimize')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  optimize(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Req() req,
    @Body() dto: OptimizeRouteDto,
  ) {
    return this.deliveryRoutesService.optimize(
      organizationId,
      routeId,
      dto,
      req.user.sub,
    );
  }

  @Post(':id/stops')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  addStop(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Req() req,
    @Body() dto: AddRouteStopDto,
  ) {
    return this.deliveryRoutesService.addStop(
      organizationId,
      routeId,
      dto,
      req.user.sub,
    );
  }

  @Patch(':id/stops/reorder')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  reorderStops(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Req() req,
    @Body() dto: ReorderRouteStopsDto,
  ) {
    return this.deliveryRoutesService.reorderStops(
      organizationId,
      routeId,
      dto,
      req.user.sub,
    );
  }

  @Delete(':id/stops/:stopId')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  removeStop(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
  ) {
    return this.deliveryRoutesService.removeStop(
      organizationId,
      routeId,
      stopId,
      req.user.sub,
    );
  }

  // Corrects a stop's pin for this route only — see setStopDestination.
  @Patch(':id/stops/:stopId/destination')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  setStopDestination(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
    @Body() dto: SetRouteStartDto,
  ) {
    return this.deliveryRoutesService.setStopDestination(
      organizationId,
      routeId,
      stopId,
      dto,
      req.user.sub,
    );
  }

  // Customer stops only — a DO stop edits these on its delivery order.
  @Patch(':id/stops/:stopId/details')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  updateCustomerStopDetails(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Body() dto: UpdateCustomerStopDetailsDto,
  ) {
    return this.deliveryRoutesService.updateCustomerStopDetails(
      organizationId,
      routeId,
      stopId,
      dto,
    );
  }

  @Post(':id/stops/:stopId/reschedule')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER')
  rescheduleCustomerStop(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
    @Body() dto: RescheduleCustomerStopDto,
  ) {
    return this.deliveryRoutesService.rescheduleCustomerStop(
      organizationId,
      routeId,
      stopId,
      dto,
      req.user.sub,
    );
  }

  // ─── Customer stop proof / failure ─────────────────────────────────
  // Stops without a delivery order. DRIVER allowed — scoped to their own
  // team's route in the service. DO stops keep using /delivery-orders.
  @Post(':id/stops/:stopId/proof-photo')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER', 'DRIVER')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_PHOTO_UPLOAD_BYTES },
    }),
  )
  uploadStopProofPhoto(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.stopProof.uploadPhoto(organizationId, routeId, stopId, file, req.user);
  }

  @Get(':id/stops/:stopId/proof-photo-link')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER', 'DRIVER')
  stopProofPhotoLink(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
  ) {
    return this.stopProof.photoLink(organizationId, routeId, stopId, req.user);
  }

  @Patch(':id/stops/:stopId/proof')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER', 'DRIVER')
  recordStopProof(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
    @Body() dto: RecordCustomerStopProofDto,
  ) {
    return this.deliveryRoutesService.recordCustomerStopProof(
      organizationId,
      routeId,
      stopId,
      dto,
      req.user,
    );
  }

  @Post(':id/stops/:stopId/failure')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'USER', 'DRIVER')
  recordStopFailure(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
    @Param('stopId') stopId: string,
    @Req() req,
    @Body() dto: RecordCustomerStopFailureDto,
  ) {
    return this.deliveryRoutesService.recordCustomerStopFailure(
      organizationId,
      routeId,
      stopId,
      dto,
      req.user,
    );
  }
}
