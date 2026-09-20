import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateSupplierPaymentDto {
  @IsUUID()
  purchaseOrderId: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  note?: string;

  // Required whenever method isn't CASH — see SupplierPaymentsService.create().
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}