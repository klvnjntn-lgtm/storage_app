import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service'; // adjust path if different
import { CreateLicenseDto } from './dto/create-license.dto';

type LicenseState = {
  valid: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'UNKNOWN';
  expiresAt: string | null;
  lastSuccessfulCheckIn: Date | null;
};

@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger(LicenseService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Optimistic default so a fresh container isn't dead on arrival
  // before its first successful check-in.
  private state: LicenseState = {
    valid: true,
    status: 'UNKNOWN',
    expiresAt: null,
    lastSuccessfulCheckIn: null,
  };

  private readonly GRACE_PERIOD_DAYS = 10;

  async onModuleInit() {
    await this.verify();
  }

  @Cron(CronExpression.EVERY_12_HOURS)
  async scheduledVerify() {
    await this.verify();
  }

  async verify(): Promise<void> {
    const key = process.env.LICENSE_KEY;

    if (!key) {
      this.logger.error('LICENSE_KEY is not set');
      this.state = { ...this.state, valid: false, status: 'UNKNOWN' };
      return;
    }

    try {
      const license = await this.prisma.license.findUnique({ where: { key } });

      if (!license) {
        this.state = {
          valid: false,
          status: 'UNKNOWN',
          expiresAt: null,
          lastSuccessfulCheckIn: this.state.lastSuccessfulCheckIn,
        };
        return;
      }

      const expired = license.expiresAt ? license.expiresAt < new Date() : false;
      const effectiveStatus = expired ? 'EXPIRED' : (license.status as LicenseState['status']);

      this.state = {
        valid: license.status === 'ACTIVE' && !expired,
        status: effectiveStatus,
        expiresAt: license.expiresAt?.toISOString() ?? null,
        lastSuccessfulCheckIn: new Date(),
      };

      // track when this instance last checked in
      await this.prisma.license.update({
        where: { key },
        data: { lastCheckIn: new Date() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`License check failed: ${message}`);
      // Don't punish a transient failure — only go invalid after the
      // grace period has elapsed since the last successful check-in.
      if (this.isGraceExpired()) {
        this.state.valid = false;
      }
    }
  }

  private isGraceExpired(): boolean {
    if (!this.state.lastSuccessfulCheckIn) return false;
    const elapsedMs = Date.now() - this.state.lastSuccessfulCheckIn.getTime();
    return elapsedMs > this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  }

  getStatus(): LicenseState {
    return this.state;
  }

  isValid(): boolean {
    return this.state.valid;
  }

  async createLicense(dto: CreateLicenseDto) {
    return this.prisma.license.create({
      data: {
        key: dto.key,
        customerName: dto.customerName,
        branchName: dto.branchName,
        domain: dto.domain,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        status: 'ACTIVE',
      },
    });
  }
}