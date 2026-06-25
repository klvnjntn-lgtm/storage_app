import {
  IsString,
  IsNumber,
} from 'class-validator';

export class AdjustStockDto {
  @IsString()
  productId!: string;

  @IsString()
  locationId!: string;

  @IsNumber()
  qtyDelta!: number;

  @IsString()
  reason!: string;
}