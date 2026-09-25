import { Module } from '@nestjs/common';
import { OsrmService } from './osrm.service';

@Module({
  providers: [OsrmService],
  exports: [OsrmService],
})
export class RoutingModule {}
