// src/delivery-routes/dto/optimize-route.dto.ts
import { IsDateString, IsOptional } from 'class-validator';

export class OptimizeRouteDto {
  // Falls back to the route's existing plannedDepartureAt, then now(). On a
  // route already underway, a time in the past is treated as now().
  @IsOptional()
  @IsDateString()
  departureAt?: string;
}
