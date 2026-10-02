import { ArrayMaxSize, IsArray, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// Every field needs a class-validator decorator: the global ValidationPipe
// runs with whitelist: true, which strips undecorated properties — before
// these were added, every row arrived as {} and was skipped as incomplete.
// Values are only type-checked here; blank refs/SKUs and non-positive or
// fractional quantities are reported per row by IntegrationService, so one
// bad row doesn't reject the whole file.
class ParsedRowDto {
  @IsString()
  @MaxLength(200)
  externalRef!: string;

  @IsString()
  @MaxLength(200)
  sku!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customerName?: string;
}

export class ConfirmImportDto {
  @IsString()
  connectionId!: string;

  // The column mapping the user confirmed in the preview step —
  // saved back onto the IntegrationConnection for next time.
  @IsObject()
  columnMapping!: Record<string, string>;

  @IsArray()
  @ArrayMaxSize(20000)
  @ValidateNested({ each: true })
  @Type(() => ParsedRowDto)
  rows!: ParsedRowDto[];
}
