// src/delivery-order/dto/delivery-order-proof.dto.ts
import { IsDateString, IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

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

  // Single-shot GPS capture from navigator.geolocation at the moment the
  // driver taps "delivered" — not continuous tracking. See DeliveryOrder's
  // completedLatitude/completedLongitude schema comment.
  @IsOptional()
  @IsLatitude()
  completedLatitude?: number;

  @IsOptional()
  @IsLongitude()
  completedLongitude?: number;

  // Uploaded separately via the existing POST /media first; this is just
  // the returned URL, same denormalized-URL convention as avatarUrl/logoUrl.
  @IsOptional()
  @IsString()
  proofPhotoUrl?: string;
}