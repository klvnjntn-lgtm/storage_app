import { IsString } from 'class-validator';

export class PushSubscriptionDto {
  @IsString()
  endpoint!: string;

  @IsString()
  p256dh!: string;

  @IsString()
  auth!: string;
}

export class UnsubscribeDto {
  @IsString()
  endpoint!: string;
}
