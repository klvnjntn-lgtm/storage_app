import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PurchaseReturnItemDto {
  @IsUUID()
  purchaseOrderItemId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity!: number;

  // Batch-tracked products: which batch the units come out of.
  @IsOptional()
  @IsString()
  batchId?: string;

  // Serial-tracked products: which units, one per quantity.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreatePurchaseReturnDto {
  @IsString()
  locationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseReturnItemDto)
  items!: PurchaseReturnItemDto[];
}
