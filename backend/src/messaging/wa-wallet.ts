import { BadRequestException } from '@nestjs/common';
import { Prisma, WaLedgerKind } from '@prisma/client';

type Tx = Prisma.TransactionClient;

// The prepaid WhatsApp balance. Plain functions over the caller's
// transaction (like inventory-costing.ts), so billing can credit a top-up
// inside its own settlement transaction without depending on the
// messaging module.
//
// Organization.waBalance is the running total; every change also writes a
// WaLedgerEntry with the balance after it, so the history always adds up
// to the balance and can be shown as a statement.

export const DEFAULT_WA_PRICE_PER_MESSAGE = 500;

export function waPricePerMessage(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.WA_PRICE_PER_MESSAGE);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WA_PRICE_PER_MESSAGE;
}

// Top-up packages offered on the WhatsApp page: what's paid -> what's
// credited. Bigger packages get a little extra.
export const WA_TOPUP_PACKAGES = [
  { amount: 50_000, credit: 50_000 },
  { amount: 100_000, credit: 102_000 },
  { amount: 250_000, credit: 260_000 },
  { amount: 500_000, credit: 530_000 },
  { amount: 1_000_000, credit: 1_080_000 },
];

async function lockBalance(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ waBalance: string }[]>`
    SELECT "waBalance" FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
  if (!rows[0]) throw new BadRequestException('Organization not found');
  return Number(rows[0].waBalance);
}

export class InsufficientWaBalanceError extends BadRequestException {
  constructor(balance: number, price: number) {
    super({
      statusCode: 400,
      error: 'InsufficientWhatsAppBalance',
      balance,
      price,
      message: `Not enough WhatsApp balance (Rp ${balance.toLocaleString('id-ID')}; one message costs Rp ${price.toLocaleString('id-ID')}). Top up to send.`,
    });
  }
}

async function apply(
  tx: Tx,
  organizationId: string,
  delta: number,
  entry: {
    kind: WaLedgerKind;
    messageLogId?: string;
    billingPaymentId?: string;
    note?: string;
    createdById?: string | null;
  },
) {
  const balance = await lockBalance(tx, organizationId);
  const after = Math.round((balance + delta) * 100) / 100;
  await tx.organization.update({
    where: { id: organizationId },
    data: {
      waBalance: after,
      // A top-up re-arms the low-balance warning.
      ...(delta > 0 && { waLowBalanceNotifiedAt: null }),
    },
  });
  return tx.waLedgerEntry.create({
    data: {
      organizationId,
      kind: entry.kind,
      amount: delta,
      balanceAfter: after,
      messageLogId: entry.messageLogId,
      billingPaymentId: entry.billingPaymentId,
      note: entry.note,
      createdById: entry.createdById ?? null,
    },
  });
}

// Takes the price of one message, or throws InsufficientWaBalanceError.
export async function chargeWaMessage(
  tx: Tx,
  organizationId: string,
  price: number,
  createdById?: string | null,
) {
  const balance = await lockBalance(tx, organizationId);
  if (balance < price) throw new InsufficientWaBalanceError(balance, price);
  return apply(tx, organizationId, -price, {
    kind: WaLedgerKind.MESSAGE,
    createdById,
  });
}

export function refundWaMessage(
  tx: Tx,
  organizationId: string,
  price: number,
  note: string,
) {
  return apply(tx, organizationId, price, { kind: WaLedgerKind.REFUND, note });
}

export function creditWaTopup(
  tx: Tx,
  organizationId: string,
  credit: number,
  billingPaymentId: string,
) {
  return apply(tx, organizationId, credit, {
    kind: WaLedgerKind.TOPUP,
    billingPaymentId,
  });
}

// Platform console: goodwill credit or correction (negative allowed, but
// never below zero).
export async function adjustWaBalance(
  tx: Tx,
  organizationId: string,
  delta: number,
  note: string,
  createdById: string,
) {
  const balance = await lockBalance(tx, organizationId);
  if (balance + delta < 0)
    throw new BadRequestException('Adjustment would make the balance negative');
  return apply(tx, organizationId, delta, {
    kind: WaLedgerKind.ADJUSTMENT,
    note,
    createdById,
  });
}
