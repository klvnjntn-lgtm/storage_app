import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { DepreciationMethod, PaymentMethod } from '@prisma/client';

export class CreateFixedAssetDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsDateString()
  acquisitionDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cost: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvageValue?: number;

  @IsInt()
  @Min(1)
  usefulLifeMonths: number;

  @IsOptional()
  @IsEnum(DepreciationMethod)
  depreciationMethod?: DepreciationMethod;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

// Mirrors RecordExpensePaymentDto — pays down FixedAsset.amountPaid one
// installment at a time, same as ExpensePayment does for Expense.
export class RecordFixedAssetPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod = PaymentMethod.CASH;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  // Required whenever method isn't CASH — see FixedAssetsService.recordPayment().
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class DisposeFixedAssetDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  proceeds?: number;

  // Required whenever proceeds > 0 — see FixedAssetsService.dispose().
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsDateString()
  disposedAt?: string;
}

export class RunDepreciationDto {
  @IsOptional()
  @IsDateString()
  through?: string;
}
