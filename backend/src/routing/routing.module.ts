import { Module } from '@nestjs/common';
import { OsrmService } from './osrm.service';
import { VroomService } from './vroom.service';

@Module({
  providers: [OsrmService, VroomService],
  exports: [OsrmService, VroomService],
})
export class RoutingModule {}
