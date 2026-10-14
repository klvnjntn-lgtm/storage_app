import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class TwoFactorLoginDto {
  @IsString()
  mfaToken!: string;

  // A 6-digit authenticator code or a recovery code (XXXXX-XXXXX).
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @MaxLength(20)
  code!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  @IsString()
  password!: string;
}

export class TwoFactorPolicyDto {
  @IsBoolean()
  require2faForAdmins!: boolean;
}
