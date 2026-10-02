import { IsNumber, IsOptional, IsString, Min, ValidateIf } from 'class-validator';

// One product's price for one price level. price null = no price for that
// level (sales lines at that level fall back to the default price).
export class ProductLevelPriceDto {
  @IsString()
  priceLevelId!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  price!: number | null;
}
