// src/delivery-order/dto/delivery-order-proof.dto.ts
import { IsDateString, IsOptional, IsString } from 'class-validator';

// All fields optional — the frontend only sends whichever of
// deliveredBy/receivedBy the user actually filled in (see
// DeliveryOrderDetailPage.handleRecordProof), and the service
// falls back to existing/`new Date()` values for anything omitted.
export class RecordDeliveryOrderProofDto {
  @IsOptional()
  @IsString()
  deliveredBy?: string;

  @IsOptional()
  @IsString()
  receivedBy?: string;

  @IsOptional()
  @IsDateString()
  signedAt?: string;
}