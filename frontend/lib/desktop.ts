import { useSyncExternalStore } from 'react';

// The WareSys desktop app (desktop/ — Electron) runs this frontend and the
// backend locally, on its own database, and exposes `window.waresysDesktop`
// from its preload script. Inside it the app is cut down to the INVOICE_POS
// side: Sales (invoices), Purchasing, Accounting, plus what
// they need — customers, the product list, settings and user admin.
// Not to be confused with the license's "desktop edition" (the local-server
// install), which is unrelated.

type DesktopBridge = {
  isDesktop: true;
  version: string;
};

declare global {
  interface Window {
    waresysDesktop?: DesktopBridge;
  }
}

export const DESKTOP_HOME = '/sales';

// Route prefixes reachable in the desktop app. Matched on whole path
// segments, so '/inventory/stock' allows /inventory/stock/123 but not
// /inventory itself.
//
// Selling is POS-style there (like Olsera): straight to an invoice, with no
// quotations, sales orders or delivery orders — those stay on the web.
const DESKTOP_ROUTES = [
  '/sales',
  '/purchasing',
  '/accounting',
  '/customers',
  '/inventory/stock',
  '/settings',
  '/admin',
];

// Self-serve billing is a cloud thing: the desktop app is licensed per install.
const DESKTOP_HIDDEN_ROUTES = ['/sales/quotations', '/sales/orders', '/sales/delivery-orders', '/settings/billing', '/settings/whatsapp'];

const under = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`);

export function isDesktopRoute(pathname: string): boolean {
  return DESKTOP_ROUTES.some((r) => under(pathname, r)) && !DESKTOP_HIDDEN_ROUTES.some((r) => under(pathname, r));
}

export function desktopBridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.waresysDesktop;
}

// The bridge is set before any page script runs and never changes, so
// there is nothing to subscribe to; the server snapshot is always false.
const noSubscribe = () => () => {};

export function useIsDesktopApp(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => !!desktopBridge()?.isDesktop,
    () => false,
  );
}
