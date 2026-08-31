import { IsISO8601 } from 'class-validator';

export class SnoozeReminderDto {
  @IsISO8601()
  dueDate!: string;
}