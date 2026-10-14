import { Logger, ServiceUnavailableException } from '@nestjs/common';

// Where a BillingPayment is actually paid. Xendit's hosted invoice page is
// the production gateway — one checkout link covering VA transfer, QRIS,
// e-wallets and cards, which is what Indonesian customers expect.
//
// Without XENDIT_SECRET_KEY outside production, the "fake" gateway stands
// in: its checkout page is our own /billing/checkout/:id, where a button
// marks the payment paid (BillingController.fakePay). It refuses to exist in
// production, so a missing key there disables checkout instead of making
// every plan free.

export type CreateCheckoutParams = {
  externalId: string;
  amount: number;
  description: string;
  payerEmail?: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
};

export type CheckoutSession = {
  gatewayInvoiceId: string | null;
  checkoutUrl: string;
  expiresAt: Date | null;
};

export type GatewayInvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'UNKNOWN';

export interface PaymentGateway {
  readonly name: 'xendit' | 'fake';
  createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession>;
  // Asked again before a webhook is believed: the webhook body is only
  // trusted to say *which* payment changed, never that it was paid.
  fetchStatus(gatewayInvoiceId: string): Promise<GatewayInvoiceStatus>;
}

const INVOICE_DURATION_SECONDS = 24 * 60 * 60;

export class XenditGateway implements PaymentGateway {
  readonly name = 'xendit' as const;
  private readonly logger = new Logger(XenditGateway.name);

  constructor(
    private readonly secretKey: string,
    private readonly baseUrl = 'https://api.xendit.co',
  ) {}

  private headers() {
    return {
      Authorization: `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`,
      'Content-Type': 'application/json',
    };
  }

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    const res = await fetch(`${this.baseUrl}/v2/invoices`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        external_id: params.externalId,
        amount: params.amount,
        currency: 'IDR',
        description: params.description,
        invoice_duration: INVOICE_DURATION_SECONDS,
        payer_email: params.payerEmail,
        success_redirect_url: params.successRedirectUrl,
        failure_redirect_url: params.failureRedirectUrl,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      this.logger.error(
        `Xendit invoice creation failed (${res.status}): ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'The payment provider could not create a checkout. Please try again.',
      );
    }
    return {
      gatewayInvoiceId: String(body.id),
      checkoutUrl: String(body.invoice_url),
      expiresAt: body.expiry_date ? new Date(String(body.expiry_date)) : null,
    };
  }

  async fetchStatus(gatewayInvoiceId: string): Promise<GatewayInvoiceStatus> {
    const res = await fetch(
      `${this.baseUrl}/v2/invoices/${encodeURIComponent(gatewayInvoiceId)}`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) {
      this.logger.warn(
        `Xendit status lookup for ${gatewayInvoiceId} failed (${res.status})`,
      );
      return 'UNKNOWN';
    }
    const body = (await res.json()) as { status?: string };
    // SETTLED = paid and already disbursed to us; both mean paid.
    if (body.status === 'PAID' || body.status === 'SETTLED') return 'PAID';
    if (body.status === 'EXPIRED') return 'EXPIRED';
    if (body.status === 'PENDING') return 'PENDING';
    return 'UNKNOWN';
  }
}

export class FakeGateway implements PaymentGateway {
  readonly name = 'fake' as const;

  constructor(private readonly appUrl: string) {}

  async createCheckout(params: CreateCheckoutParams): Promise<CheckoutSession> {
    return {
      gatewayInvoiceId: null,
      checkoutUrl: `${this.appUrl}/billing/checkout/${encodeURIComponent(params.externalId)}`,
      expiresAt: new Date(Date.now() + INVOICE_DURATION_SECONDS * 1000),
    };
  }

  async fetchStatus(): Promise<GatewayInvoiceStatus> {
    return 'UNKNOWN';
  }
}

export function createPaymentGateway(
  env: NodeJS.ProcessEnv = process.env,
): PaymentGateway | null {
  // Off until the business can take online payments (Xendit needs an NIB);
  // subscriptions are recorded by hand from the platform console meanwhile.
  if (env.ONLINE_PAYMENTS_ENABLED !== 'true') return null;
  if (env.XENDIT_SECRET_KEY)
    return new XenditGateway(
      env.XENDIT_SECRET_KEY,
      env.XENDIT_API_URL || undefined,
    );
  if (env.NODE_ENV !== 'production')
    return new FakeGateway(env.APP_URL || 'http://localhost:3000');
  return null;
}
