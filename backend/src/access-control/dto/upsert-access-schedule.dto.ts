import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:mm", 24h

export class AccessScheduleWindowDto {
  @IsIn(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
  dayOfWeek!: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

  @IsString()
  @Matches(TIME_PATTERN, { message: 'startTime must be "HH:mm"' })
  startTime!: string;

  @IsString()
  @Matches(TIME_PATTERN, { message: 'endTime must be "HH:mm"' })
  endTime!: string;
}

// A full weekly replace, not incremental add/remove — matches how a 7-day
// grid admin UI naturally submits ("save this whole week"). An empty array
// clears all restriction (back to unrestricted).
export class UpsertAccessScheduleDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AccessScheduleWindowDto)
  windows!: AccessScheduleWindowDto[];
}
