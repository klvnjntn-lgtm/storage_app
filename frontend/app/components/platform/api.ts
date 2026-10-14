import { apiFetch } from '@/lib/apifetch';
import { parseCalendarDate, toCalendarDateString } from '@/lib/dates';

// Shapes returned by the backend's /platform routes (src/platform).

export type ModuleKey = 'INVOICE_POS' | 'WAREHOUSE_OPS' | 'WORKSHOP_RMS' | 'DELIVERY_DMS';
export const MODULE_KEYS: ModuleKey[] = ['INVOICE_POS', 'WAREHOUSE_OPS', 'WORKSHOP_RMS', 'DELIVERY_DMS'];

// Mirrors backend src/billing/plans.ts.
export const PLAN_KEYS = ['custom', 'trial', 'subscription', 'free'] as const;

export type PlatformSession = { email: string; unlocked: boolean; unlockedUntil: string | null };

export type PlatformOrg = {
  id: string;
  name: string;
  plan: string;
  seatLimit: number;
  seatsUsed: number;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  // Prepaid WhatsApp balance (IDR, Decimal as string).
  waBalance?: string;
  billingNote: string | null;
  lastActiveAt: string | null;
  // The plan whose limits apply now (a lapsed trial/paid plan reads "free").
  effectivePlan?: string;
  // Metered on the list endpoint only.
  usage?: { products: number; invoices30d: number; mediaBytes: number };
  modules: { module: ModuleKey; enabled: boolean; expiresAt: string | null }[];
};

export type PlatformAuditEntry = {
  id: string;
  actorEmail: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

export type PlatformOrgDetail = PlatformOrg & {
  users: {
    id: string;
    email: string;
    displayName: string | null;
    role: 'ADMIN' | 'USER' | 'DRIVER';
    active: boolean;
    lastActiveAt: string | null;
  }[];
  recentAudit: PlatformAuditEntry[];
};

export type PlatformResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; code?: string };

// apiFetch for /platform: never throws, and reports the backend's
// PLATFORM_LOCKED (the 30-minute unlock ran out) as its own code so the
// page can drop back to the unlock screen.
export async function platformCall<T>(path: string, init?: RequestInit): Promise<PlatformResult<T>> {
  try {
    const res = await apiFetch(`/platform${path}`, init);
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const message = Array.isArray(body?.message) ? body.message.join(', ') : String(body?.message ?? '');
    return { ok: false, status: res.status, message, code: body?.code };
  } catch {
    return { ok: false, status: 0, message: '' };
  }
}

export function moduleIsOn(m: { enabled: boolean; expiresAt: string | null }) {
  return m.enabled && (!m.expiresAt || new Date(m.expiresAt) > new Date());
}

export type PaymentState = 'unpaid' | 'overdue' | 'dueSoon' | 'paid';

// paidUntil is a calendar date (stored as UTC midnight).
export function paymentState(paidUntil: string | null): PaymentState {
  if (!paidUntil) return 'unpaid';
  const due = toCalendarDateString(parseCalendarDate(paidUntil));
  const today = new Date();
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);
  if (due < toCalendarDateString(today)) return 'overdue';
  if (due <= toCalendarDateString(soon)) return 'dueSoon';
  return 'paid';
}

export function formatDate(iso: string | null, language: string, calendar = false) {
  if (!iso) return '';
  const d = calendar ? parseCalendarDate(iso) : new Date(iso);
  return d.toLocaleDateString(language === 'id' ? 'id-ID' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string, language: string) {
  return new Date(iso).toLocaleString(language === 'id' ? 'id-ID' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
