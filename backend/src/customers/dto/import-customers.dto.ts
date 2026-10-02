import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

// Upper bound per request. The client sends a big sheet in batches that
// stay under the default 100kb JSON body limit; each batch is checked for
// duplicates and written in one transaction.
export const MAX_CUSTOMER_IMPORT_ROWS = 1000;

// One spreadsheet row, already parsed client-side (same approach as the
// stock import). Same limits as CreateCustomerDto, except the price level
// arrives by name — a spreadsheet can't know level ids.
export class ImportCustomerRowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  npwp?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  priceLevel?: string;
}

export class ImportCustomersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CUSTOMER_IMPORT_ROWS)
  @ValidateNested({ each: true })
  @Type(() => ImportCustomerRowDto)
  rows!: ImportCustomerRowDto[];
}
