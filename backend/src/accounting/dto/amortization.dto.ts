import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AmortizationKind, AmortizationStatus, PaymentMethod } from '@prisma/client';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Paying it, either right away when it's recorded or later in installments.
export class AmortizationPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  // Required whenever method isn't CASH.
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @Matches(DATE_ONLY, { message: 'paidAt must be YYYY-MM-DD' })
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class CreateAmortizationDto {
  @IsEnum(AmortizationKind)
  kind: AmortizationKind;

  @IsString()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  // The branch it's booked to (P&L by branch). Left out: unallocated.
  @IsOptional()
  @IsString()
  branchId?: string;

  @Matches(DATE_ONLY, { message: 'startDate must be YYYY-MM-DD' })
  startDate: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  cost: number;

  // Up to 50 years.
  @IsInt()
  @Min(1)
  @Max(600)
  usefulLifeMonths: number;

  // PREPAID: required — the expense it becomes each month. Ignored for INTANGIBLE.
  @IsOptional()
  @IsUUID()
  expenseAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Paid when it was recorded (all or part of it).
  @IsOptional()
  @ValidateNested()
  @Type(() => AmortizationPaymentDto)
  payment?: AmortizationPaymentDto;
}

export class UpdateAmortizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RunAmortizationDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'through must be YYYY-MM-DD' })
  through?: string;
}

export class WriteOffAmortizationDto {
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date?: string;
}

export class ListAmortizationsQuery {
  @IsOptional()
  @IsEnum(AmortizationStatus)
  status?: AmortizationStatus;

  @IsOptional()
  @IsEnum(AmortizationKind)
  kind?: AmortizationKind;
}
