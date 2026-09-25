// src/auth/dto/login.dto.ts
import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  // Fallback source for the client-generated device id — the X-Device-Id
  // header (sent by apifetch.ts on every request) is preferred when present,
  // see AuthController.login.
  @IsOptional()
  @IsString()
  deviceId?: string;
}