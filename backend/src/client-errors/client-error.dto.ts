// src/client-errors/client-error.dto.ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

// A crash or failed page load on someone's phone, which the server otherwise
// never hears about. See ClientErrorsController.
export class ClientErrorDto {
  @IsString()
  @MaxLength(40)
  kind!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  page?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  digest?: string;
}
