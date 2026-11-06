import { useSyncExternalStore } from 'react';
import { Package, ReceiptText, Truck, Wrench, type LucideIcon } from 'lucide-react';

/* ─── The four WareSys solutions ─────────────────────────────────────
   One list shared by the hero, the solutions section and the "who it's
   for" pills, so a solution has the same name, colour, icon and deep link
   everywhere. Deliberately free of three.js: the page imports this up
   front, and low-end devices never download the 3D bundle. */

export type SolutionKey = 'warehouse' | 'sales' | 'workshop' | 'delivery';

export type Solution = {
  key: SolutionKey;
  name: string;
  icon: LucideIcon;
  /** space-separated rgb channels, for rgb(var(--zone) / a) */
  rgb: string;
  /** decorative tint on the dark 3D surfaces */
  hex: string;
  /** readable on the page in either theme (globals.css) */
  ink: string;
};

export const SOLUTIONS: Solution[] = [
  { key: 'warehouse', name: 'WareSys Warehouse', icon: Package, rgb: '96 165 250', hex: '#60a5fa', ink: 'var(--zone-ink-warehouse)' },
  { key: 'sales', name: 'Invoice POS', icon: ReceiptText, rgb: '52 211 153', hex: '#34d399', ink: 'var(--zone-ink-sales)' },
  { key: 'workshop', name: 'Workshop RMS', icon: Wrench, rgb: '251 191 36', hex: '#fbbf24', ink: 'var(--zone-ink-workshop)' },
  { key: 'delivery', name: 'Delivery DMS', icon: Truck, rgb: '167 139 250', hex: '#a78bfa', ink: 'var(--zone-ink-delivery)' },
];

export const solutionByKey = (key: SolutionKey) => SOLUTIONS.find((s) => s.key === key)!;
export const isSolutionKey = (v: string): v is SolutionKey => SOLUTIONS.some((s) => s.key === v);

/* ─── Hero bus ───────────────────────────────────────────────────────
   Connects the hero copy with the canvas without re-rendering either:
     active  the zone the 3D story is on; the matching chip lights up
     focus   the chip under the pointer; the camera flies to that zone
   The canvas reads `focus` every frame. Only the chips subscribe. */
let active: SolutionKey | null = null;
const listeners = new Set<() => void>();

export const heroBus = {
  focus: null as SolutionKey | null,
  setActive(next: SolutionKey | null) {
    if (next === active) return;
    active = next;
    listeners.forEach((l) => l());
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useHeroActive = () =>
  useSyncExternalStore(
    subscribe,
    () => active,
    () => null,
  );
