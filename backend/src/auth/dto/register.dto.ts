import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'Must be a valid email address' })
  @IsNotEmpty()
  email: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Organization name must be at least 2 characters long' })
  organizationName: string;

  // FIX — organizationId/role were removed here. AuthService.register()
  // deliberately never accepted either (see its own comment: taking them
  // from the client was the original vulnerability — it always creates a
  // brand-new org with the caller as its first ADMIN). The fields stayed
  // on this DTO, still validated and accepted by the ValidationPipe, even
  // though the service signature only ever took email/password/
  // organizationName — misleading about the actual contract, even if not
  // itself exploitable. Joining an existing org happens only via invite().
}