import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoutingModule } from '../routing/routing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryRoutesService } from './delivery-routes.service';
import { DeliveryReportService } from './delivery-report.service';
import { DeliveryRoutesController } from './delivery-routes.controller';
import { RouteOptimizerService } from './route-optimizer.service';
import { RoutePlannerService } from './route-planner.service';
import { StopProofService } from './stop-proof.service';
import { StopShareTokenService } from './stop-share-token.service';
import { PublicStopController } from './public-stop.controller';
import { OrganizationModulesModule } from '../organization-module/organization-modules.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    PrismaModule,
    RoutingModule,
    NotificationsModule,
    OrganizationModulesModule,
    StorageModule,
  ],
  controllers: [DeliveryRoutesController, PublicStopController],
  providers: [
    DeliveryRoutesService,
    RouteOptimizerService,
    RoutePlannerService,
    StopProofService,
    StopShareTokenService,
    DeliveryReportService,
  ],
  exports: [DeliveryRoutesService],
})
export class DeliveryRoutesModule {}
