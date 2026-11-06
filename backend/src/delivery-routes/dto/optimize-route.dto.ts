// src/delivery-routes/dto/optimize-route.dto.ts
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class OptimizeRouteDto {
  // Just work out the visiting order: no departure time, ETAs, working hours or
  // delivery windows. What the route page sends when no departure time is filled in.
  @IsOptional()
  @IsBoolean()
  orderOnly?: boolean;

  // Falls back to the route's existing plannedDepartureAt, then the start of
  // the driver's day on the route's date (never earlier than now). On a route
  // already underway, a time in the past or no time at all is treated as now().
  @IsOptional()
  @IsDateString()
  departureAt?: string;
}
