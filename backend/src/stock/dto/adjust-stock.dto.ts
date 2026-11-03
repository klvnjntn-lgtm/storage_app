import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class AdjustStockDto {
  @IsString()
  productId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  qtyDelta!: number;

  // A stock count: the quantity counted on the shelf. When given, the change
  // is worked out against the stock at save time and qtyDelta is ignored —
  // the delta the page showed may be stale if something sold meanwhile.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  countedQty?: number;

  @IsString()
  reason!: string;
}