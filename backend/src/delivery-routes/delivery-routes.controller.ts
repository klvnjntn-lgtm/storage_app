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
  UseGuards,
} from '@nestjs/common';
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

@UseGuards(JwtAuthGuard, OrgGuard, ModuleGuard)
@RequireModule(ModuleKey.DELIVERY_DMS)
@Controller('delivery-routes')
export class DeliveryRoutesController {
  constructor(private readonly deliveryRoutesService: DeliveryRoutesService) {}

  @Post()
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
    @Query('driverId') driverId?: string,
    @Query('date') date?: string,
    @Query('status') status?: RouteStatus,
  ) {
    return this.deliveryRoutesService.listRoutes(
      organizationId,
      { driverId, date, status },
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
  monitoringSummary(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringSummary(organizationId, date);
  }

  @Get('monitoring/drivers')
  monitoringByDriver(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringByDriver(organizationId, date);
  }

  @Get('monitoring/map')
  monitoringMap(
    @CurrentOrg() organizationId: string,
    @Query('date') date?: string,
  ) {
    return this.deliveryRoutesService.monitoringMap(organizationId, date);
  }

  // Static segment — MUST stay above the :id routes below, same reasoning
  // as 'mine' and 'monitoring/*'.
  @Get('drivers')
  listDrivers(@CurrentOrg() organizationId: string) {
    return this.deliveryRoutesService.listDrivers(organizationId);
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
  getHistory(
    @CurrentOrg() organizationId: string,
    @Param('id') routeId: string,
  ) {
    return this.deliveryRoutesService.getHistory(organizationId, routeId);
  }

  // Route-mutation endpoints are ADMIN/USER-only — a DRIVER may view their
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
}
