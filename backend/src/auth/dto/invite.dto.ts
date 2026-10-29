// src/auth/dto/invite.dto.ts
import { IsEmail, IsString, MinLength, IsOptional, IsIn } from 'class-validator';

export class InviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsIn(['MASTER', 'ADMIN', 'USER', 'DRIVER', 'MECHANIC'])
  role?: 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER' | 'MECHANIC';

  // For an ADMIN or USER: the branch they'll work at. A MASTER chooses; a
  // branch ADMIN's invites always go to their own branch.
  @IsOptional()
  @IsString()
  branchId?: string;
}
