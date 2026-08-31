// payments/dto/record-payment.dto.ts
import { IsInt, IsPositive, IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RecordPaymentDto {
  @IsInt()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod = PaymentMethod.CASH;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}