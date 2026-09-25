// src/delivery-routes/dto/set-route-start.dto.ts
import { IsLatitude, IsLongitude } from 'class-validator';

export class SetRouteStartDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
