import { IsIn } from 'class-validator';

export class SetRoleDto {
  @IsIn(['MASTER', 'ADMIN', 'USER', 'DRIVER'])
  role!: 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER';
}
