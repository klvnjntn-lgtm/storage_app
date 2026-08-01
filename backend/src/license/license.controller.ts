import { Controller, Get, Post, Body, Headers, ForbiddenException } from '@nestjs/common';
import { LicenseService } from './license.service';
import { SkipLicenseCheck } from './decorators/skip-license-check.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { LicenseStatusDto } from './dto/license-status.dto';
import { CreateLicenseDto } from './dto/create-license.dto';

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

  @Post('admin/create')
  @Public()
  @SkipLicenseCheck()
  createLicense(
    @Body() dto: CreateLicenseDto,
    @Headers('x-superadmin-secret') secret: string,
  ) {
    if (secret !== process.env.SUPERADMIN_SECRET) {
      throw new ForbiddenException();
    }
    return this.licenseService.createLicense(dto);
  }
}