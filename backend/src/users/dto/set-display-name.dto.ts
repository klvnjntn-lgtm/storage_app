import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SetDisplayNameDto {
  // Empty string or null clears the name (UI falls back to email).
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string | null;
}
