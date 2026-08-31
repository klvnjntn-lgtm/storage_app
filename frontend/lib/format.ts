// lib/format.ts

export function formatIDR(amount: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Shorter form for tight layouts (e.g. 3-up summary cards on narrow
// phones) — e.g. "Rp 12,3jt" instead of "Rp 12.345.678", which doesn't
// fit three-across on a small screen without wrapping or overflowing.
export function formatIDRCompact(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}jt`;
  if (abs >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}rb`;
  return formatIDR(amount);
}

export type PaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export function paymentStatusStyle(status: PaymentStatus): string {
  switch (status) {
    case 'PAID':
      return 'bg-green-50 text-green-700 border-green-300';
    case 'PARTIAL':
      return 'bg-amber-50 text-amber-700 border-amber-300';
    case 'UNPAID':
      return 'bg-red-50 text-red-700 border-red-300';
  }
}