import { Logger } from '@nestjs/common';

// Sends WhatsApp messages. Production uses Meta's WhatsApp Business Cloud
// API (WA_PHONE_NUMBER_ID + WA_ACCESS_TOKEN). Messages a business starts
// must use a template approved in Meta Business Manager; the template
// names are configured per message type (WA_TEMPLATE_* in .env), each
// with a DOCUMENT header (the PDF) and numbered body parameters in the
// order the callers pass them.
//
// Outside production with no credentials, LogWhatsAppProvider stands in:
// it logs the message and reports success, so the whole flow — balance,
// charging, logging — can be exercised without a Meta account.

export type WhatsAppSendParams = {
  to: string; // digits only, country code first (6281234567890)
  template: string;
  language: string;
  bodyParams: string[];
  document?: { url: string; filename: string };
};

export type WhatsAppSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export interface WhatsAppProvider {
  readonly name: 'meta' | 'log';
  send(params: WhatsAppSendParams): Promise<WhatsAppSendResult>;
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta' as const;
  private readonly logger = new Logger(MetaCloudWhatsAppProvider.name);

  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
    private readonly apiVersion = 'v21.0',
  ) {}

  async send(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    const components: Record<string, unknown>[] = [];
    if (params.document) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'document',
            document: {
              link: params.document.url,
              filename: params.document.filename,
            },
          },
        ],
      });
    }
    if (params.bodyParams.length) {
      components.push({
        type: 'body',
        parameters: params.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }
    try {
      const res = await fetch(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: params.to,
            type: 'template',
            template: {
              name: params.template,
              language: { code: params.language },
              components,
            },
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        messages?: { id: string }[];
        error?: { message?: string };
      };
      if (!res.ok || !body.messages?.[0]?.id) {
        const error = body.error?.message ?? `HTTP ${res.status}`;
        this.logger.warn(`WhatsApp send to ${params.to} failed: ${error}`);
        return { ok: false, error };
      }
      return { ok: true, messageId: body.messages[0].id };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export class LogWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'log' as const;
  private readonly logger = new Logger('WhatsApp(log)');

  async send(params: WhatsAppSendParams): Promise<WhatsAppSendResult> {
    this.logger.log(
      `[not sent — dev provider] to=${params.to} template=${params.template} params=${JSON.stringify(params.bodyParams)}` +
        (params.document ? ` document=${params.document.url}` : ''),
    );
    return { ok: true, messageId: `log-${Date.now()}` };
  }
}

export function createWhatsAppProvider(
  env: NodeJS.ProcessEnv = process.env,
): WhatsAppProvider | null {
  // Off until a WhatsApp Business account is verified; email still works.
  if (env.WHATSAPP_ENABLED !== 'true') return null;
  if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
    return new MetaCloudWhatsAppProvider(
      env.WA_PHONE_NUMBER_ID,
      env.WA_ACCESS_TOKEN,
      env.WA_API_VERSION || undefined,
    );
  }
  if (env.NODE_ENV !== 'production') return new LogWhatsAppProvider();
  return null;
}

// Indonesian numbers as people type them (0812-3456-7890, +62 812…, 62812…)
// to the digits-only international form WhatsApp wants. Null when it
// doesn't look like a phone number at all.
export function normalizeWhatsAppNumber(
  raw: string | null | undefined,
  defaultCountryCode = '62',
): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0'))
    digits = defaultCountryCode + digits.slice(1);
  digits = digits.replace(/\D/g, '');
  return digits.length >= 9 && digits.length <= 15 ? digits : null;
}
