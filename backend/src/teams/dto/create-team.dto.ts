// src/teams/dto/create-team.dto.ts
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTeamDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;
}
