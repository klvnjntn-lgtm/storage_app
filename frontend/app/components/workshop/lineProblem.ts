import type { DraftLine } from './workOrders';

type T = (key: string, vars?: Record<string, string | number>) => string;

// The first thing that would make the server reject the lines, phrased
// for the form — or null when they're fine.
export function lineProblem(lines: DraftLine[], t: T): string | null {
  for (const l of lines) {
    if (!(l.quantity > 0)) return t('workshop.workOrders.errQty');
    if (l.kind === 'part' && !l.locationId) return t('workshop.workOrders.errLocation', { name: l.name });
    if (l.kind === 'labour' && !l.description.trim()) return t('workshop.workOrders.errLabour');
  }
  return null;
}
