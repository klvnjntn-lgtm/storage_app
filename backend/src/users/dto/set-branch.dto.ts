import { IsNotEmpty, IsString } from 'class-validator';

export class SetBranchDto {
  @IsString()
  @IsNotEmpty()
  branchId!: string;
}
