// src/delivery-routes/dto/plan-routes.dto.ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class PlanDepotDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}

// "Optimize all teams" preview: VROOM splits the chosen deliveries across
// the chosen teams (one vehicle each). Nothing is saved.
export class PlanRoutesDto {
  @IsDateString()
  routeDate: string;

  // Falls back to the start of each driver's working hours, then now().
  @IsOptional()
  @IsDateString()
  departureAt?: string;

  @ValidateNested()
  @Type(() => PlanDepotDto)
  depot: PlanDepotDto;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  teamIds: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  deliveryOrderIds: string[];
}

export class PlannedTeamRouteDto {
  @IsString()
  teamId: string;

  // Visiting order, exactly as the preview returned it.
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  deliveryOrderIds: string[];
}

// Saves a previewed plan. Carries the preview's input plus its result, so
// what gets saved is exactly what the admin looked at — not a fresh solve.
export class ApplyRoutePlanDto extends PlanRoutesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlannedTeamRouteDto)
  routes: PlannedTeamRouteDto[];

  // routeId → Route.version at preview time; a route that changed since
  // (someone edited it) fails the save instead of being overwritten.
  @IsObject()
  expectedVersions: Record<string, number>;
}

export class PlanCandidatesQueryDto {
  @IsDateString()
  routeDate: string;
}
