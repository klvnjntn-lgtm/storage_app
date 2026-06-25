// src/auth/dto/set-seat-limit.dto.ts
import { IsInt, Min } from 'class-validator';

export class SetSeatLimitDto {
  @IsInt()
  @Min(1)
  seatLimit!: number;
}