// payments/dto/record-payment.dto.ts
import { IsInt, IsPositive, IsOptional, IsEnum, IsString, IsUUID, MaxLength, IsNumber } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class RecordPaymentDto {
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

  // NEW — which specific OrganizationBankAccount the money landed in.
  // Required whenever method isn't CASH; see PaymentService.recordPayment().
  // This is what lets the Account Ledger show "BCA Operating Account"
  // rather than one undifferentiated Bank balance.
  @IsOptional()
  @IsUUID()
  bankAccountId?: string;
}