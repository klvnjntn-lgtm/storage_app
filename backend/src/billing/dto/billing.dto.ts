import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
} from 'class-validator';
import { ModuleKey } from '@prisma/client';

export class SubscriptionCheckoutDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsEnum(ModuleKey, { each: true })
  modules!: ModuleKey[];

  @IsIn(['MONTH', 'YEAR'])
  period!: 'MONTH' | 'YEAR';
}
