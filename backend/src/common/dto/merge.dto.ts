// src/common/dto/merge.dto.ts
import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class MergeDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  sourceIds!: string[];

  @IsString()
  targetId!: string;
}