export class LicenseStatusDto {
  valid!: boolean;
  status!: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN' | 'SUSPENDED' | 'NOT_ACTIVATED';
  expiresAt?: string | null;
  message?: string;
}