import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSupplierBillDto {
  @IsString()
  @MaxLength(100)
  billNumber!: string;

  @Matches(DATE_ONLY, { message: 'billDate must be YYYY-MM-DD' })
  billDate!: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
