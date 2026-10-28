import { Type } from 'class-transformer';
import { IsISO8601, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  note!: string;

  @IsISO8601()
  dueDate!: string;

  // Also due once the car's odometer reaches this (km), whichever comes first.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dueOdometer?: number;
}
