import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderLineDto)
  items!: ReorderLineDto[];
}
