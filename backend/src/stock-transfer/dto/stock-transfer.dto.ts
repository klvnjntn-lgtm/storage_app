import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class StockTransferItemDto {
  @IsString()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity!: number;

  // Serial-tracked products: the units moving, one per quantity.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}

export class CreateStockTransferDto {
  @IsString()
  fromLocationId!: string;

  @IsString()
  toLocationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // Ship and receive in one step: the stock is at the destination as soon
  // as this is saved.
  @IsOptional()
  @IsBoolean()
  quickMove?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferItemDto)
  items!: StockTransferItemDto[];
}

export class ReceiveTransferLineDto {
  @IsString()
  itemId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  receivedQuantity!: number;

  // Serial-tracked lines that came up short: the units that didn't arrive.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingSerials?: string[];
}

export class ReceiveStockTransferDto {
  // Omitted = everything arrived. Lines left out of a partial list are
  // taken as fully received.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferLineDto)
  items?: ReceiveTransferLineDto[];
}
