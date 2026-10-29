import { ModuleKey } from '@prisma/client';

// What self-serve businesses pay for: each module is its own
// subscription, bought by the month or by the year, with its own
// paid-until date (OrganizationModule.paidUntil). Prices in IDR.
export type BillingPeriod = 'MONTH' | 'YEAR';

export type ModulePrice = {
  module: ModuleKey;
  monthly: number;
  yearly: number;
  // Another module that must be active (or bought alongside) first.
  requires?: ModuleKey;
};

export const MODULE_PRICES: ModulePrice[] = [
  { module: ModuleKey.INVOICE_POS, monthly: 300_000, yearly: 3_000_000 },
  { module: ModuleKey.WAREHOUSE_OPS, monthly: 400_000, yearly: 4_000_000 },
  {
    module: ModuleKey.WORKSHOP_RMS,
    monthly: 360_000,
    yearly: 3_600_000,
    requires: ModuleKey.INVOICE_POS,
  },
  { module: ModuleKey.DELIVERY_DMS, monthly: 700_000, yearly: 7_000_000 },
  {
    module: ModuleKey.ACCOUNTING,
    monthly: 250_000,
    yearly: 2_500_000,
    requires: ModuleKey.INVOICE_POS,
  },
];

export function modulePrice(module: ModuleKey, period: BillingPeriod): number {
  const row = MODULE_PRICES.find((p) => p.module === module);
  if (!row) throw new Error(`${module} is not sold`);
  return period === 'YEAR' ? row.yearly : row.monthly;
}

// The account's state, stored in Organization.plan:
//   custom       — managed by hand from the platform console: every org that
//                  predates self-serve billing, and every licensed install.
//                  Only Organization.seatLimit applies.
//   trial        — a self-serve signup's first TRIAL_DAYS, with every module
//                  and the trial limits below.
//   subscription — has bought modules at least once. No usage limits: what
//                  a business can use is decided by which modules it pays
//                  for (ModuleGuard checks each one's expiry).
//   free         — never stored; what a trial becomes once it ends without
//                  a purchase (the free limits apply).
export type PlanKey = 'custom' | 'free' | 'trial' | 'subscription';

export type PlanLimits = {
  seats: number | null;
  locations: number | null;
  products: number | null;
  invoicesPerMonth: number | null;
};

const UNLIMITED: PlanLimits = {
  seats: null,
  locations: null,
  products: null,
  invoicesPerMonth: null,
};

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  custom: UNLIMITED,
  subscription: UNLIMITED,
  trial: { seats: 5, locations: 2, products: 1000, invoicesPerMonth: 300 },
  free: { seats: 1, locations: 1, products: 100, invoicesPerMonth: 30 },
};

// Kept as an object so the platform console can validate a plan key.
export const PLANS: Record<PlanKey, { key: PlanKey }> = {
  custom: { key: 'custom' },
  free: { key: 'free' },
  trial: { key: 'trial' },
  subscription: { key: 'subscription' },
};

export const TRIAL_DAYS = 14;
export const TRIAL_MODULES: ModuleKey[] = [
  ModuleKey.INVOICE_POS,
  ModuleKey.WAREHOUSE_OPS,
  ModuleKey.WORKSHOP_RMS,
  ModuleKey.DELIVERY_DMS,
  ModuleKey.ACCOUNTING,
];

// A module keeps working this long after its paid-until date, so a renewal
// paid a day late doesn't cut the business off mid-shift.
export const GRACE_DAYS = 3;

export function isPlanKey(value: string): value is PlanKey {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

type OrgPlanState = {
  plan: string;
  trialEndsAt: Date | null;
  paidUntil?: Date | null;
};

// The plan whose limits apply now. An ended trial falls back to "free", and
// so does a subscription once every module it paid for is past its grace
// days (Organization.paidUntil mirrors the furthest-out one). A
// subscription with no paidUntil was set by hand and keeps its plan.
// Unknown strings (hand-typed in the platform console before billing
// existed) count as "custom" so they never lock anyone out.
export function effectivePlan(org: OrgPlanState, now = new Date()): PlanKey {
  if (!isPlanKey(org.plan)) return 'custom';
  if (org.plan === 'trial')
    return org.trialEndsAt && org.trialEndsAt > now ? 'trial' : 'free';
  if (org.plan === 'subscription' && org.paidUntil) {
    const graceEnds = org.paidUntil.getTime() + GRACE_DAYS * 86_400_000;
    return graceEnds > now.getTime() ? 'subscription' : 'free';
  }
  return org.plan;
}

// A month or a year after `from`, for extending a module's paid-until.
export function addPeriod(from: Date, period: BillingPeriod): Date {
  const d = new Date(from);
  if (period === 'YEAR') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}
