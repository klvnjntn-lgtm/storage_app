// src/delivery-routes/dto/update-route.dto.ts
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RouteStatus } from '@prisma/client';

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(RouteStatus)
  status?: RouteStatus;

  @IsOptional()
  @IsString()
  driverId?: string;
}
