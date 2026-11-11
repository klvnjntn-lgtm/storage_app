import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// null clears a field (stops watching the product).
export class ReorderSettingsDto {
  @IsOptional()
  @ValidateIf((o: ReorderSettingsDto) => o.reorderPoint !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  reorderPoint?: number | null;

  @IsOptional()
  @ValidateIf((o: ReorderSettingsDto) => o.reorderQuantity !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  reorderQuantity?: number | null;

  @IsOptional()
  @ValidateIf((o: ReorderSettingsDto) => o.preferredSupplierId !== null)
  @IsUUID()
  preferredSupplierId?: string | null;

  // Set a branch's own reorder point instead of the product's business-wide one.
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ReorderLineDto {
  @IsString()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  quantity!: number;

  @IsUUID()
  supplierId!: string;
}

export class CreateReorderPosDto {
  @IsOptional()
  @IsString() @IsNotEmpty()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderLineDto)
  items!: ReorderLineDto[];
}

export class AutoFillReorderDto {
  // How far back to average sales over.
  @IsInt()
  @Min(7)
  @Max(365)
  salesDays!: number;

  // Days of stock the reorder point should cover — about how long an order takes to arrive.
  @IsInt()
  @Min(1)
  @Max(180)
  coverDays!: number;

  // Leave products that already have a reorder point alone.
  @IsOptional()
  @IsBoolean()
  onlyEmpty?: boolean;

  // false = preview only.
  @IsOptional()
  @IsBoolean()
  apply?: boolean;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ImportReorderRowDto {
  @IsOptional()
  @IsString()
  sku?: string | null;

  @IsOptional()
  @IsString()
  name?: string | null;

  @IsOptional()
  @ValidateIf((o: ImportReorderRowDto) => o.reorderPoint !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  reorderPoint?: number | null;

  @IsOptional()
  @ValidateIf((o: ImportReorderRowDto) => o.reorderQuantity !== null)
  @IsNumber({ maxDecimalPlaces: 2 })
  reorderQuantity?: number | null;

  @IsOptional()
  @IsString()
  supplier?: string | null;
}

export class ImportReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50000)
  @ValidateNested({ each: true })
  @Type(() => ImportReorderRowDto)
  rows!: ImportReorderRowDto[];

  @IsOptional()
  @IsUUID()
  branchId?: string;
}
