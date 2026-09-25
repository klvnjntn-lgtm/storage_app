// src/delivery-routes/dto/optimize-route.dto.ts
import { IsDateString, IsOptional } from 'class-validator';

export class OptimizeRouteDto {
  // Falls back to the route's existing plannedDepartureAt, then now().
  @IsOptional()
  @IsDateString()
  departureAt?: string;
}
