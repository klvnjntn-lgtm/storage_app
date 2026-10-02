// Guided-tour registry — one independent tour per module.
//
// A module opts in by listing its routes and giving its tour some steps;
// TourProvider, the Help menu and the first-use prompt pick it up from
// here with no module-specific code. `title` / `description` are i18n
// keys (see app/i18n/modules/tour.ts) so tours follow the UI language.
//
// Targets are `[data-tour='…']` attributes, never layout classes. The
// same attribute may appear more than once (e.g. desktop sidebar and
// mobile top bar); the first *visible* match is highlighted, and a step
// whose target isn't on screen (hidden on this breakpoint, or data-
// dependent like the pending-orders card) is dropped when the tour
// starts. A step with no target shows as a centred card.

import type { Side } from 'driver.js';

export type TourStep = {
  target?: string;
  title: string;
  description: string;
  side?: Side;
};

export type TourModuleId = 'ops' | 'pos' | 'rms' | 'delivery';

export type TourConfig = {
  id: string;
  /** i18n key for the module's display name. */
  title: string;
  /** Organization module that must be enabled for this tour to be offered. */
  requiresModule: 'WAREHOUSE_OPS' | 'INVOICE_POS' | 'WORKSHOP_RMS' | 'DELIVERY_DMS';
  /** Route prefixes that belong to the module. */
  routes: string[];
  /** Page the tour runs on; starting it from elsewhere in the module navigates here first. */
  startPath: string;
  steps: TourStep[];
};

const t = (id: TourModuleId, step: string) => ({
  title: `tour.${id}.steps.${step}.title`,
  description: `tour.${id}.steps.${step}.description`,
});

export const tours: Record<TourModuleId, TourConfig> = {
  // Follows the real OPS flow: find stock → start a session → receive is
  // import-first → resume open sessions → print labels.
  ops: {
    id: 'ops-tour',
    title: 'tour.ops.title',
    requiresModule: 'WAREHOUSE_OPS',
    routes: ['/inventory/warehouse', '/inventory/sessions', '/inventory/labels'],
    startPath: '/inventory/warehouse',
    steps: [
      { ...t('ops', 'intro') },
      { target: "[data-tour='ops-search']", side: 'bottom', ...t('ops', 'search') },
      { target: "[data-tour='ops-pending-orders']", side: 'bottom', ...t('ops', 'pendingOrders') },
      { target: "[data-tour='ops-modes']", ...t('ops', 'modes') },
      { target: "[data-tour='ops-mode-receive']", side: 'bottom', ...t('ops', 'receive') },
      { target: "[data-tour='ops-recent-sessions']", side: 'bottom', ...t('ops', 'sessions') },
      { target: "[data-tour='nav-labels']", side: 'right', ...t('ops', 'labels') },
      { target: "[data-tour='help-menu']", ...t('ops', 'replay') },
    ],
  },

  // Quotation → Sales Order → Invoice → Delivery Order, each converting
  // into the next; customers and purchasing round out the module.
  pos: {
    id: 'pos-tour',
    title: 'tour.pos.title',
    requiresModule: 'INVOICE_POS',
    routes: ['/sales', '/purchasing', '/customers', '/accounting'],
    startPath: '/sales',
    steps: [
      { ...t('pos', 'intro') },
      { target: "[data-tour='pos-search']", side: 'bottom', ...t('pos', 'search') },
      { target: "[data-tour='pos-card-quotations']", ...t('pos', 'quotation') },
      { target: "[data-tour='pos-card-orders']", ...t('pos', 'order') },
      { target: "[data-tour='pos-card-invoices']", ...t('pos', 'invoice') },
      { target: "[data-tour='pos-card-delivery-orders']", ...t('pos', 'deliveryOrder') },
      { target: "[data-tour='nav-customers']", side: 'right', ...t('pos', 'customers') },
      { target: "[data-tour='nav-purchasing']", side: 'right', ...t('pos', 'purchasing') },
      { target: "[data-tour='help-menu']", ...t('pos', 'replay') },
    ],
  },

  // Vehicle → service billed as an invoice on that vehicle → reminder
  // brings the customer back.
  rms: {
    id: 'rms-tour',
    title: 'tour.rms.title',
    requiresModule: 'WORKSHOP_RMS',
    routes: ['/workshop'],
    startPath: '/workshop',
    steps: [
      { ...t('rms', 'intro') },
      { target: "[data-tour='rms-search']", side: 'bottom', ...t('rms', 'search') },
      { target: "[data-tour='rms-card-vehicles']", ...t('rms', 'vehicles') },
      { ...t('rms', 'service') },
      { target: "[data-tour='rms-card-reminders']", ...t('rms', 'reminders') },
      { target: "[data-tour='help-menu']", ...t('rms', 'replay') },
    ],
  },

  // Plan routes per team → driver works them on a phone → watch live.
  // The Drivers card is admin-only and drops out for everyone else.
  delivery: {
    id: 'delivery-tour',
    title: 'tour.delivery.title',
    requiresModule: 'DELIVERY_DMS',
    routes: ['/delivery'],
    startPath: '/delivery',
    steps: [
      { ...t('delivery', 'intro') },
      { target: "[data-tour='dlv-card-routes']", ...t('delivery', 'routes') },
      { ...t('delivery', 'driverApp') },
      { target: "[data-tour='dlv-card-monitoring']", ...t('delivery', 'monitoring') },
      { target: "[data-tour='dlv-card-drivers']", ...t('delivery', 'drivers') },
      { target: "[data-tour='help-menu']", ...t('delivery', 'replay') },
    ],
  },
};

export function tourForPath(pathname: string): TourModuleId | null {
  for (const [id, tour] of Object.entries(tours) as [TourModuleId, TourConfig][]) {
    if (tour.routes.some((r) => pathname === r || pathname.startsWith(`${r}/`))) return id;
  }
  return null;
}

// ── Page tours ─────────────────────────────────────────────────────────
// Deeper, single-page tours (Delivery Routes, Driver access control, New
// quotation …). Each belongs to a module (for gating and naming) and runs
// on the page it's for — no navigation. `path` is the route pattern;
// `[id]` matches one segment. Steps live in pageTours.ts.

export type PageTourConfig = {
  module: TourModuleId;
  /** i18n key for the page's display name. */
  title: string;
  path: string;
  steps: TourStep[];
};

// Any tour, module overview or page, by id. Module tours keep their
// original ids ('ops', 'pos', …) so saved progress carries over.
export type AnyTour = {
  id: string;
  kind: 'module' | 'page';
  module: TourModuleId;
  title: string;
  steps: TourStep[];
  /** Module tours navigate here first; page tours run where they are. */
  startPath?: string;
  matches: (pathname: string) => boolean;
};

// '/delivery/routes/[id]' → one regex; '[id]' matches a single segment.
const patternToRegex = (path: string) =>
  new RegExp(
    '^' +
      path
        .split('/')
        .map((seg) => (seg === '[id]' ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
        .join('/') +
      '/?$',
  );

export function makePageTourRegistry(pageTours: Record<string, PageTourConfig>) {
  const compiled = Object.entries(pageTours).map(([id, cfg]) => ({ id, cfg, re: patternToRegex(cfg.path) }));

  function pageTourForPath(pathname: string): string | null {
    return compiled.find((c) => c.re.test(pathname))?.id ?? null;
  }

  function getTour(id: string): AnyTour | null {
    if (id in tours) {
      const m = tours[id as TourModuleId];
      return {
        id,
        kind: 'module',
        module: id as TourModuleId,
        title: m.title,
        steps: m.steps,
        startPath: m.startPath,
        matches: (p) => p === m.startPath,
      };
    }
    const page = compiled.find((c) => c.id === id);
    if (!page) return null;
    return { id, kind: 'page', module: page.cfg.module, title: page.cfg.title, steps: page.cfg.steps, matches: (p) => page.re.test(p) };
  }

  return { pageTourForPath, getTour };
}
