import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class KeygenService {
  private readonly logger = new Logger(KeygenService.name);
  private readonly accountId = process.env.KEYGEN_ACCOUNT_ID;

  private baseUrl() {
    return `https://api.keygen.sh/v1/accounts/${this.accountId}`;
  }

  // Validate + activate use license-key auth — no admin/account token
  // required or shipped to customers. This is the pattern Keygen expects
  // for self-hosted / distributed deployments.
  async validateKey(licenseKey: string, fingerprint: string) {
    const res = await fetch(`${this.baseUrl()}/licenses/actions/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
        Authorization: `License ${licenseKey}`,
      },
      body: JSON.stringify({
        meta: {
          key: licenseKey,
          scope: {
            fingerprint,
          },
        },
      }),
    });

    const json = await res.json();

    this.logger.log(`KEYGEN RESPONSE ${JSON.stringify(json)}`);

    return json;
  }

  async activateMachine(licenseKey: string, licenseId: string, fingerprint: string) {
    const res = await fetch(`${this.baseUrl()}/machines`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Accept: 'application/vnd.api+json',
        Authorization: `License ${licenseKey}`,
      },
      body: JSON.stringify({
        data: {
          type: 'machines',
          attributes: { fingerprint },
          relationships: {
            license: { data: { type: 'licenses', id: licenseId } },
          },
        },
      }),
    });
    return res.json();
  }

  // createLicense intentionally removed from the customer-shipped app.
  // License issuance requires an admin/account token, which must never
  // be distributed. Run license creation from a separate internal tool
  // that you control and never ship.
}

