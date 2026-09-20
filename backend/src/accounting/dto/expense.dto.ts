import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
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

  @IsNumber()
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