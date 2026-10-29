import { IsIn } from 'class-validator';

export class SetRoleDto {
  @IsIn(['MASTER', 'ADMIN', 'USER', 'DRIVER', 'MECHANIC'])
  role!: 'MASTER' | 'ADMIN' | 'USER' | 'DRIVER' | 'MECHANIC';
}
