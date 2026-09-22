import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateExpenseCategoryDto {
  @IsString()
  name: string;

  // Which GL expense account this category posts to. Omit to fall back to
  // UNCATEGORIZED_EXPENSE — fine to start with, but every category should
  // get its own account eventually, or your P&L just shows one lump
  // "Uncategorized Expense" line instead of "Electricity" / "Rent" / etc.
  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CreateExpenseDto {
  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  // FIX — was @IsNumber() with no maxDecimalPlaces; storage is
  // Decimal(14,2), so excess-precision input was silently rounded by
  // Postgres at insert rather than rejected up front.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount: number;

  @IsDateString()
  expenseDate: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class MarkExpensePaidDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  // Which specific OrganizationBankAccount the payment went out of.
  // Required whenever paymentMethod isn't CASH — see ExpensesService.markPaid().
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}

// FIX — mirrors payments/dto/record-payment.dto.ts's RecordPaymentDto.
// Lets a caller record a partial or full payment against an expense,
// via ExpensesService.recordPayment(), instead of only the old
// all-or-nothing markPaid().
export class RecordExpensePaymentDto {
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

  // Required whenever method isn't CASH — see ExpensesService.recordPayment().
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}