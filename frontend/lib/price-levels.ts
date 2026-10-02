'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/apifetch';

// Organization-wide price levels (Retail, Wholesale, …) — see the
// PriceLevel model in the backend schema. The default level's price for a
// product is product.sellingPrice; other levels' prices are in
// product.prices (blank = not set).
export type PriceLevel = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  archivedAt: string | null;
};

export type LevelPriced = {
  sellingPrice: number | null;
  // Absent when the line was restored from a saved document (no live
  // product prices loaded) — the level then can't be re-picked.
  prices?: { priceLevelId: string; price: number }[];
};

// Mirrors LineItemPricingService.resolveProductPrice on the server so the
// cart shows exactly what will be charged: the level's own price, else the
// default price with the default level as the true source.
export function resolveLinePrice(product: LevelPriced, levelId: string | null, defaultLevelId: string | null) {
  if (levelId && levelId !== defaultLevelId) {
    const own = product.prices?.find((p) => p.priceLevelId === levelId);
    if (own) return { unitPrice: own.price, sourceLevelId: levelId, fallback: false };
  }
  return {
    unitPrice: product.sellingPrice,
    sourceLevelId: defaultLevelId,
    fallback: !!levelId && levelId !== defaultLevelId,
  };
}

let cache: Promise<PriceLevel[]> | null = null;

function load(): Promise<PriceLevel[]> {
  if (!cache) {
    cache = apiFetch('/organization/price-levels?includeArchived=true')
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => []);
    // Don't keep a failed/empty load forever.
    cache.then((levels) => {
      if (levels.length === 0) cache = null;
    });
  }
  return cache;
}

// Settings calls this after editing levels.
export function invalidatePriceLevels() {
  cache = null;
}

export function usePriceLevels() {
  const [all, setAll] = useState<PriceLevel[]>([]);
  useEffect(() => {
    let alive = true;
    load().then((levels) => alive && setAll(levels));
    return () => {
      alive = false;
    };
  }, []);
  const levels = all.filter((l) => !l.archivedAt);
  const defaultLevel = all.find((l) => l.isDefault) ?? null;
  return {
    /** Active levels, default first. */
    levels,
    activeLevelIds: new Set(levels.map((l) => l.id)),
    defaultLevelId: defaultLevel?.id ?? null,
    /** Name for any level id, archived ones included (for old documents). */
    nameOf: (id: string | null | undefined) => (id ? all.find((l) => l.id === id)?.name ?? null : null),
  };
}

type LevelledLine = {
  product: LevelPriced;
  unitPrice: number;
  priceLevelId?: string | null;
  priceLevelOverridden?: boolean;
  priceCustom?: boolean;
};

// A cart line's effective level and price, derived at render time: lines
// nobody re-levelled follow the document's level (the customer's, else the
// default), so changing the customer re-prices them; hand-picked levels
// and typed (POS) prices stay put.
// activeLevelIds: once levels have loaded, a line pinned to a level that has
// since been archived follows the document's level instead (the server
// rejects archived levels on new prices).
export function applyPriceLevel<L extends LevelledLine>(
  line: L,
  baseLevelId: string | null,
  defaultLevelId: string | null,
  activeLevelIds?: Set<string>,
): L {
  if (line.priceCustom || !line.product.prices) return line;
  const pinned =
    line.priceLevelOverridden &&
    !!line.priceLevelId &&
    (!activeLevelIds || activeLevelIds.size === 0 || activeLevelIds.has(line.priceLevelId));
  const levelId = pinned ? line.priceLevelId! : baseLevelId;
  const r = resolveLinePrice(line.product, levelId, defaultLevelId);
  return { ...line, priceLevelId: levelId ?? defaultLevelId, unitPrice: r.unitPrice ?? line.unitPrice };
}

// Level state for a line reloaded from a saved document. Saved lines are
// pinned to the level they were saved with, so reopening a draft never
// silently re-prices it. A product line saved without a level had a typed
// (POS) price, or predates price levels: keep its saved price as-is —
// deciding this from the POS setting would race that setting's load and
// could overwrite a typed price on the next autosave.
export function restoredLevelFields(savedLevelId: string | null | undefined) {
  if (!savedLevelId) return { priceLevelId: null, priceLevelOverridden: false, priceCustom: true };
  return { priceLevelId: savedLevelId, priceLevelOverridden: true, priceCustom: false };
}

// Server sends Decimal prices as strings.
export function toLevelPrices(prices: { priceLevelId: string; price: string | number }[] | undefined) {
  return prices?.map((p) => ({ priceLevelId: p.priceLevelId, price: Number(p.price) }));
}
