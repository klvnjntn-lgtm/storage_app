import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class ShipLineSerialsDto {
  @IsString()
  itemId!: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  serialNumbers!: string[];
}

// POST /delivery-orders/:id/ship — the body is optional. serials names the
// units of serial-tracked products on each line; see DeliveryOrderService.ship.
export class ShipDeliveryOrderDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ShipLineSerialsDto)
  serials?: ShipLineSerialsDto[];
}
