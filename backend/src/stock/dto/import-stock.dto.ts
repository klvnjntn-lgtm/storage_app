import { ArrayMaxSize, IsArray, IsEnum } from 'class-validator';
import { ImportMode } from '../stock.service';

export type ImportStockRow = {
  sku: string;
  name: string;
  category: string;
  brand?: string;
  location: string;
  qty: number;
  sellingPrice?: number;
  costPrice?: number;
};

export class ImportStockDto {
  @IsEnum(ImportMode)
  mode!: ImportMode;

  // Rows are checked one by one in StockService.import(), which reports
  // each bad row with a reason instead of rejecting the whole file — so
  // only the array itself is validated here.
  @IsArray()
  @ArrayMaxSize(20000)
  rows!: ImportStockRow[];
}
