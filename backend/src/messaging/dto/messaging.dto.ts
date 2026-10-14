import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { MessageChannel } from '@prisma/client';

export class SendDocumentDto {
  @IsEnum(MessageChannel)
  channel!: MessageChannel;

  // Overrides the customer's/supplier's saved email or phone.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  to?: string;

  // Added to the email body (ignored for WhatsApp, whose text is the
  // approved template).
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class SendStatementDto extends SendDocumentDto {
  @IsString()
  customerId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodFrom!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  periodTo!: string;
}

export class TopupDto {
  @IsInt()
  amount!: number;
}

export class MessagingSettingsDto {
  @IsOptional()
  @IsBoolean()
  reminderEmailEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reminderWhatsappEnabled?: boolean;
}
