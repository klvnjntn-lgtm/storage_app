import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoutingModule } from '../routing/routing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DeliveryRoutesService } from './delivery-routes.service';
import { DeliveryRoutesController } from './delivery-routes.controller';

@Module({
  imports: [PrismaModule, RoutingModule, NotificationsModule],
  controllers: [DeliveryRoutesController],
  providers: [DeliveryRoutesService],
  exports: [DeliveryRoutesService],
})
export class DeliveryRoutesModule {}
