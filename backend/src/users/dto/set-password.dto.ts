import { IsString, MaxLength, MinLength } from 'class-validator';

// An admin setting a driver's password (UsersService.setDriverPassword).
export class SetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
