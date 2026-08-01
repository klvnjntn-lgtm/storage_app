export class LicenseStatusDto {
  valid!: boolean;
  status!: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt?: string | null;
  message?: string;
}