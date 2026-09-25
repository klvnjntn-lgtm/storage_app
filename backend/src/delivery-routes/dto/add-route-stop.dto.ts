// src/delivery-routes/dto/add-route-stop.dto.ts
import { IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class AddRouteStopDto {
  @IsString()
  deliveryOrderId: string;

  // Omit to append at the end of the route.
  @IsOptional()
  @IsInt()
  @IsPositive()
  sequence?: number;
}
