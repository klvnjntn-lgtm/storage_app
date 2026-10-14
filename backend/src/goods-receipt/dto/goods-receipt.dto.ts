import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ReceiveGoodsItemDto {
  @IsUUID()
  purchaseOrderItemId: string;

  // Quantity is Decimal(12,2) on PurchaseOrderItem/GoodsReceiptItem — must
  // accept fractional quantities, but never zero/negative. Previously this
  // DTO had no validation at all, so a negative quantity could reach the
  // service and be persisted on lines where poItem.productId is null
  // (unmapped SKUs from gdb-import), skipping StockService.increase()'s
  // own qty <= 0 check entirely.
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity: number;

  // Required for products that track batches (Product.trackBatches).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  batchNumber?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'expiryDate must be YYYY-MM-DD' })
  expiryDate?: string;

  // Required for products that track serial numbers — one per unit.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  serialNumbers?: string[];
}

export class ReceiveGoodsDto {
  @IsString()
  locationId: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveGoodsItemDto)
  items: ReceiveGoodsItemDto[];
}
