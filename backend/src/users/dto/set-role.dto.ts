import { IsIn } from 'class-validator';

export class SetRoleDto {
  @IsIn(['ADMIN', 'USER', 'DRIVER'])
  role!: 'ADMIN' | 'USER' | 'DRIVER';
}
