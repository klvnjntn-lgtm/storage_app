// src/delivery-routes/dto/proof-photo-meta.dto.ts
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// Multipart fields sent alongside a photo taken on the device: when and
// where it was taken. Multipart values arrive as strings, hence @Type.
// Also used for customer location photos (CustomerLocationController).
export class PhotoCaptureMetaDto {
  @IsOptional()
  @IsDateString()
  takenAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

// A proof photo (DO and customer stops) also carries the receiver name
// typed so far.
export class ProofPhotoMetaDto extends PhotoCaptureMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  receivedBy?: string;
}

// The receiver name typed before Done, saved as the driver types.
export class ProofDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  receivedBy?: string;
}
