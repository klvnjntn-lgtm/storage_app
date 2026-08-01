import { SetMetadata } from '@nestjs/common';

export const SKIP_LICENSE_CHECK = 'skipLicenseCheck';
export const SkipLicenseCheck = () => SetMetadata(SKIP_LICENSE_CHECK, true);