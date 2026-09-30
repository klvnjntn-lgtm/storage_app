import JsBarcode from 'jsbarcode';

// Code 128 only carries printable ASCII. Anything else (accented letters, an
// en dash pasted from Excel) can't be encoded — JsBarcode would silently
// render nothing — so it's rejected up front and the label falls back to QR.
export function isCode128Encodable(value: string) {
  return /^[\x20-\x7E]+$/.test(value);
}

// The Code 128 symbol as a module string ("1" = bar, "0" = space), without
// quiet zones. JsBarcode picks the densest code set (numeric runs are
// packed two digits per symbol), so this is the true symbol width.
export function code128Modules(value: string): string | null {
  if (!value || !isCode128Encodable(value)) return null;
  const out: { encodings?: { data: string }[] } = {};
  let valid = true;
  try {
    JsBarcode(out as unknown as HTMLElement, value, {
      format: 'CODE128',
      valid: (v: boolean) => {
        valid = v;
      },
    });
  } catch {
    return null;
  }
  if (!valid || !out.encodings?.length) return null;
  return out.encodings.map((e) => e.data).join('');
}

export const QUIET_ZONE_MODULES = 10; // Code 128 minimum on each side
const MAX_MODULE_MM = 0.5;

export type BarcodePlan = {
  modules: string;
  moduleMm: number;
  symbolWidthMm: number; // bars only
  quietZoneMm: number; // each side
  // False when the bars would be thinner than a handheld scanner can read
  // reliably at this printer resolution — the UI warns and suggests QR or a
  // wider label instead of printing something that won't scan.
  scannable: boolean;
};

// Minimum reliable bar ("X") width. 203 dpi thermal heads need at least two
// dots per bar; finer printers can go to the ~0.19 mm floor most handheld
// scanners resolve.
export function minModuleMm(dpi: number) {
  const dot = 25.4 / dpi;
  return Math.max(2 * dot, dpi <= 203 ? 0.25 : 0.19);
}

// Chooses the bar width for a label: the widest whole number of printer
// dots that still fits the symbol plus both quiet zones in the space
// available. Whole dots matter on thermal printers — a bar 1.4 dots wide
// prints as 1 or 2 dots at random, which is exactly what makes a barcode
// fail to scan.
export function planBarcode(value: string, availableWidthMm: number, dpi: number): BarcodePlan | null {
  const modules = code128Modules(value);
  if (!modules) return null;

  const dot = 25.4 / dpi;
  const count = modules.length;
  const ideal = Math.min(availableWidthMm / (count + 2 * QUIET_ZONE_MODULES), MAX_MODULE_MM);
  const dots = Math.max(1, Math.floor(ideal / dot + 1e-9));
  const moduleMm = dots * dot;

  return {
    modules,
    moduleMm,
    symbolWidthMm: count * moduleMm,
    quietZoneMm: QUIET_ZONE_MODULES * moduleMm,
    scannable: moduleMm + 1e-9 >= minModuleMm(dpi),
  };
}

// Bar runs as [start, width] in modules, for drawing one <rect> per bar.
export function barRuns(modules: string): [number, number][] {
  const runs: [number, number][] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] === '1') {
      const start = i;
      while (i < modules.length && modules[i] === '1') i++;
      runs.push([start, i - start]);
    } else {
      i++;
    }
  }
  return runs;
}
