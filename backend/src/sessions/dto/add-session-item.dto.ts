import {
  IsString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsIn,
  IsArray,
} from 'class-validator';

const RETURN_REASONS = [
  'DAMAGED',
  'WRONG_ITEM',
  'CHANGED_MIND',
  'DEFECTIVE',
  'OTHER',
] as const;

export class AddSessionItemDto {
  @IsString()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  qty!: number;

  @IsOptional()
  @IsString()
  fromLocationId?: string;

  @IsOptional()
  @IsString()
  toLocationId?: string;

  @IsOptional()
  @IsIn(RETURN_REASONS)
  reason?: string;

  // MOVE sessions, serial-tracked products: the units picked or put away,
  // one per quantity.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serialNumbers?: string[];
}