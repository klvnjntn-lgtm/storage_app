import { Controller, Get } from '@nestjs/common';
import { LicenseService } from './license.service';
import { SkipLicenseCheck } from './decorators/skip-license-check.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { LicenseStatusDto } from './dto/license-status.dto';

@Controller('license')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('status')
  @Public()
  @SkipLicenseCheck()
  getStatus(): LicenseStatusDto {
    const state = this.licenseService.getStatus();
    return {
      valid: state.valid,
      status: state.status,
      expiresAt: state.expiresAt,
      message: state.valid ? undefined : 'License invalid or expired. Contact support to renew.',
    };
  }
}