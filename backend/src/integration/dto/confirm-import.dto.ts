import { IsString, IsObject, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class ParsedRowDto {
  externalRef!: string;
  sku!: string;
  quantity!: number;
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
  @ValidateNested({ each: true })
  @Type(() => ParsedRowDto)
  rows!: ParsedRowDto[];
}