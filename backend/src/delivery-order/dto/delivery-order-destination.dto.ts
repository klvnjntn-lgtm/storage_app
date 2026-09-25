// src/delivery-order/dto/delivery-order-destination.dto.ts
import { IsLatitude, IsLongitude } from 'class-validator';

export class SetDeliveryOrderDestinationDto {
  @IsLatitude()
  latitude: number;

  @IsLongitude()
  longitude: number;
}
