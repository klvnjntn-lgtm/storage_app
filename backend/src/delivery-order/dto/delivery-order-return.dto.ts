// src/delivery-order/dto/delivery-order-return.dto.ts
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

export class ReturnLineItemDto {
  @IsUUID()
  deliveryOrderItemId: string;

  @IsInt()
  @IsPositive()
  quantity: number;
}

export class RecordDeliveryOrderReturnDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineItemDto)
  items: ReturnLineItemDto[];

  @IsOptional()
  @IsString()
  reason?: string;
}