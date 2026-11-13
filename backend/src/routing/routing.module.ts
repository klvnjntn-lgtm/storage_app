import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OsrmService } from './osrm.service';
import { VroomService } from './vroom.service';
import { MapsLinkController } from './maps-link.controller';

@Module({
  // OrgGuard on MapsLinkController reads the database.
  imports: [PrismaModule],
  controllers: [MapsLinkController],
  providers: [OsrmService, VroomService],
  exports: [OsrmService, VroomService],
})
export class RoutingModule {}
