// src/delivery-routes/dto/driver-event.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

// Something the driver page showed or did on the phone that never reaches
// the server otherwise (a GPS failure, the camera failing, a photo kept
// for later) — logged so a "some text appeared" report can be traced.
export class DriverEventDto {
  @IsString()
  @MaxLength(60)
  kind!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  stopId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  detail?: string;
}
