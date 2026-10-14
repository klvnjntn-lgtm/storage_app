import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SerialStatus } from '@prisma/client';

export class TrackSerialsDto {
  @IsBoolean()
  trackSerials!: boolean;
}

// Admin correction: a customer return, a unit found or lost in a count.
export class CorrectSerialDto {
  @IsEnum(SerialStatus)
  status!: SerialStatus;

  @IsOptional()
  @IsString()
  locationId?: string;

  @IsString()
  @MaxLength(500)
  note!: string;
}

// Registering units that were already on the shelf before tracking began.
export class RegisterSerialsDto {
  @IsString()
  productId!: string;

  @IsString()
  locationId!: string;

  @IsString({ each: true })
  serialNumbers!: string[];
}
