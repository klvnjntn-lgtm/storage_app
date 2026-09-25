// src/delivery-routes/dto/reorder-route-stops.dto.ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsPositive, IsString, ValidateNested } from 'class-validator';

export class RouteStopSequenceDto {
  @IsString()
  stopId: string;

  @IsInt()
  @IsPositive()
  sequence: number;
}

export class ReorderRouteStopsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RouteStopSequenceDto)
  stops: RouteStopSequenceDto[];
}
