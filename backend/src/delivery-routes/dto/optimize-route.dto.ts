// src/delivery-routes/dto/optimize-route.dto.ts
import { IsDateString, IsOptional } from 'class-validator';

export class OptimizeRouteDto {
  // Falls back to the route's existing plannedDepartureAt, then the start of
  // the driver's day on the route's date (never earlier than now). On a route
  // already underway, a time in the past or no time at all is treated as now().
  @IsOptional()
  @IsDateString()
  departureAt?: string;
}
