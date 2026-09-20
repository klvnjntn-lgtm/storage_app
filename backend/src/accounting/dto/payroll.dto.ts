import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { PayrollPayType, PaymentMethod } from '@prisma/client';

export class CreatePayrollDto {
  @IsInt()
  @Min(1)
  @Max(12)
  periodMonth: number;

  @IsInt()
  @Min(2000)
  periodYear: number;

  @IsOptional()
  @IsEnum(PayrollPayType)
  payType?: PayrollPayType;

  @IsDateString()
  documentDate: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  // Omit to run payroll for every active employee in the org.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => String)
  @IsUUID('4', { each: true })
  employeeIds?: string[];
}

export class MarkPayrollPaidDto {
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}