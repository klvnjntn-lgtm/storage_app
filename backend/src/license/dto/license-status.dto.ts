export class LicenseStatusDto {
  // 'desktop' = self-hosted install (release/install.ps1), the only edition
  // licensing applies to. The frontend hides license UI otherwise.
  edition!: 'desktop' | 'cloud';
  valid!: boolean;
  status!: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN' | 'SUSPENDED' | 'NOT_ACTIVATED';
  expiresAt?: string | null;
  message?: string;
}