// src/license/license.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KeygenService } from './keygen.service';
import * as fs from 'fs';
import * as path from 'path';

const KNOWN_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'NOT_ACTIVATED', 'UNKNOWN'] as const;
type LicenseStatus = (typeof KNOWN_STATUSES)[number];

function toKnownStatus(code: unknown): LicenseStatus {
  return typeof code === 'string' && (KNOWN_STATUSES as readonly string[]).includes(code)
    ? (code as LicenseStatus)
    : 'UNKNOWN';
}

type LicenseState = {
  valid: boolean;
  status: LicenseStatus;
  expiresAt: string | null;
  lastSuccessfulCheckIn: Date | null;
};

type PersistedState = {
  lastSuccessfulCheckIn: string; // ISO date
};

@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger(LicenseService.name);
  private readonly GRACE_PERIOD_DAYS = 10;

  // Persisted outside the container's ephemeral memory so that a
  // `docker compose down && up` (or crash loop) can't be used to dodge
  // the grace-period clock. Mount this path onto a persistent volume.
  private readonly stateFilePath = process.env.LICENSE_STATE_FILE || '/data/license-state.json';

  private state: LicenseState = {
    valid: false, // fail-closed until proven otherwise
    status: 'UNKNOWN',
    expiresAt: null,
    lastSuccessfulCheckIn: null,
  };

  constructor(private readonly keygen: KeygenService) {}

  async onModuleInit() {
    this.loadPersistedState();
    await this.verify();
  }

  @Cron(CronExpression.EVERY_12_HOURS)
  async scheduledVerify() {
    await this.verify();
  }

  private loadPersistedState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed.lastSuccessfulCheckIn) {
          this.state.lastSuccessfulCheckIn = new Date(parsed.lastSuccessfulCheckIn);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not load persisted license state: ${message}`);
      // If the file is missing/corrupt, we simply have no prior
      // check-in on record — state stays at the fail-closed default.
    }
  }

  private persistState(): void {
    try {
      const dir = path.dirname(this.stateFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const payload: PersistedState = {
        lastSuccessfulCheckIn: this.state.lastSuccessfulCheckIn?.toISOString() ?? '',
      };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(payload), 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not persist license state: ${message}`);
    }
  }

  async verify(): Promise<void> {
    const key = process.env.LICENSE_KEY;
    const fingerprint = process.env.LICENSE_FINGERPRINT;

    if (!key || !fingerprint) {
      this.logger.error('LICENSE_KEY or LICENSE_FINGERPRINT is not set');
      this.state = { ...this.state, valid: false, status: 'UNKNOWN' };
      return;
    }

    // Anti-copy check: LICENSE_FINGERPRINT is recorded once, at install
    // time, into .env. HOST_MACHINE_GUID is re-read from the actual host
    // machine and passed in fresh every time `docker compose up` runs
    // (see start-up scripting). If someone copies the whole install
    // folder -- .env included -- to a different PC, the live host ID on
    // that PC won't match the fingerprint baked into the copied .env,
    // and we refuse to even attempt Keygen validation.
    const liveHostId = process.env.HOST_MACHINE_GUID;

    if (!liveHostId || liveHostId !== fingerprint) {
      this.logger.error(
        `Machine fingerprint mismatch (configured=${fingerprint}, live=${liveHostId ?? 'missing'}). ` +
          `This usually means the install folder was copied from a different machine.`,
      );
      this.state = { ...this.state, valid: false, status: 'UNKNOWN' };
      return;
    }

    try {
      let result = await this.keygen.validateKey(key, fingerprint);
      this.logger.log(`Keygen raw result: ${JSON.stringify(result)}`);

      const needsActivation = [
        'FINGERPRINT_SCOPE_MISMATCH',
        'NO_MACHINES',
        'NO_MACHINE',
      ].includes(result.meta?.code);

      if (needsActivation) {
        const licenseId = result.data?.id;
        if (licenseId) {
          const activation = await this.keygen.activateMachine(key, licenseId, fingerprint);
          this.logger.log(`Activation result: ${JSON.stringify(activation)}`);
          if (activation.data?.id) {
            this.logger.log('Machine activated for this deployment');
            result = await this.keygen.validateKey(key, fingerprint); // re-validate
            this.logger.log(`Keygen re-validate result: ${JSON.stringify(result)}`);
          } else {
            this.logger.warn(`Machine activation failed: ${JSON.stringify(activation.errors ?? activation)}`);
          }
        } else {
          this.logger.warn('Activation needed but no license id present in result.data');
        }
      }

      const valid = result.meta?.valid === true;
      const expiresAt = result.data?.attributes?.expiry ?? null;

      this.state = {
        valid,
        status: valid ? 'ACTIVE' : toKnownStatus(result.meta?.code),
        expiresAt,
        lastSuccessfulCheckIn: new Date(),
      };

      this.persistState();

      this.logger.log(`License check: valid=${valid} status=${this.state.status}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`License check failed (network/parse error): ${message}`);

      // Fail-closed by default. Only stay valid if we're still inside
      // an active grace period counted from a *previously verified*
      // successful check-in.
      this.state = {
        ...this.state,
        valid: !this.isGraceExpired(),
      };
    }
  }

  private isGraceExpired(): boolean {
    // No successful check-in on record (ever) => grace period never
    // started => treat as expired => fail closed. This is the fix for
    // the bypass: previously this returned `false` here, which let a
    // network-blocked first run stay "valid" forever.
    if (!this.state.lastSuccessfulCheckIn) return true;

    const elapsedMs = Date.now() - this.state.lastSuccessfulCheckIn.getTime();
    return elapsedMs > this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  }

  getStatus(): LicenseState {
    return this.state;
  }

  isValid(): boolean {
    return this.state.valid;
  }
}