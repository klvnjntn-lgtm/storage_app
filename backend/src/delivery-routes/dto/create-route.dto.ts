// src/delivery-routes/dto/create-route.dto.ts
import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateRouteDto {
  @IsString()
  teamId: string;

  @IsDateString()
  routeDate: string;

  @IsOptional()
  @IsString()
  name?: string;
}
