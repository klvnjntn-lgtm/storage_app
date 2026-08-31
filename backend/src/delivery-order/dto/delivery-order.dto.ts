import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class DeliveryOrderLineDto {
  @IsUUID()
  salesOrderItemId: string;

  @IsInt()
  @IsPositive()
  quantity: number;
}

export class CreateDeliveryOrderDto {
  @IsUUID()
  salesOrderId: string;

  // Session.id is a cuid(), not a UUID — stays a plain string, same
  // reasoning as Location.id elsewhere in this codebase.
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DeliveryOrderLineDto)
  items: DeliveryOrderLineDto[];

  // NEW — supports create()'s deliveryAddress fallback logic from last
  // turn. Optional: falls back to the customer's address snapshot when
  // omitted.
  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}