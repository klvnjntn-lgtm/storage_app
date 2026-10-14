import { Transform } from 'class-transformer';
import { IsEmail, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  // Where invoices, statements and payment reminders are emailed. An
  // empty string clears it.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || null : value))
  @ValidateIf((o: CreateCustomerDto) => o.email !== null)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  npwp?: string;

  // Default location for new deliveries to this customer — see
  // Customer.latitude's schema comment.
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  // DELIVERY_DMS — directions for the driver, see Customer.deliveryNotes.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryNotes?: string;

  // Price level this customer buys at; null clears it (back to the org's
  // default level). See Customer.priceLevelId.
  @IsOptional()
  @IsString()
  priceLevelId?: string | null;
}
