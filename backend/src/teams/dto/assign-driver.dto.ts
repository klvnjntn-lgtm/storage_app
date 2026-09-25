// src/teams/dto/assign-driver.dto.ts
import { IsString } from 'class-validator';

export class AssignDriverDto {
  @IsString()
  driverId: string;
}
