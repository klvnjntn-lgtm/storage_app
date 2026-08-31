import { IsISO8601, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  note!: string;

  @IsISO8601()
  dueDate!: string;
}