import { IsBoolean, IsOptional } from 'class-validator';

export class ApproveDeviceDto {
  // Also revoke the driver's other approved phones and sign them out there
  // (see DevicesService.approve). Off: the phone is added alongside them.
  @IsOptional()
  @IsBoolean()
  replaceOthers?: boolean;
}
