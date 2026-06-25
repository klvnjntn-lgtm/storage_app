// src/common/dto/rename.dto.ts
import { IsString, MinLength } from 'class-validator';

export class RenameDto {
  @IsString()
  @MinLength(1)
  name!: string;
}