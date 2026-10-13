import { IsString, MaxLength, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from './transfer-container';

// The password a .wsexport is encrypted with (chosen at export, needed to
// import it).
export class TransferPasswordDto {
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxLength(200)
  password!: string;
}
