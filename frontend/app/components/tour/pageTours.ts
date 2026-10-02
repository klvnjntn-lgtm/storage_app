// Page tours — deeper walkthroughs of individual screens. See
// PageTourConfig in tours.ts. Order matters: the first path that matches
// wins, so list literal paths ('/delivery/routes/plan') before '[id]' ones.
import type { PageTourConfig, TourStep } from './tours';

const s = (page: string, step: string, target?: string, side?: TourStep['side']): TourStep => ({
  ...(target ? { target: `[data-tour='${target}']` } : {}),
  ...(side ? { side } : {}),
  title: `tour.pages.${page}.steps.${step}.title`,
  description: `tour.pages.${page}.steps.${step}.description`,
});

export const pageTours: Record<string, PageTourConfig> = {
  // ── POS / Sales ────────────────────────────────────────────────────
  // '/new' and '/[id]/edit' are listed before '/[id]'.
  salesInvoiceNew: {
    module: 'pos',
    title: 'tour.pages.salesInvoiceNew.title',
    path: '/sales/invoices/new',
    steps: [
      s('salesInvoiceNew', 'intro'),
      s('salesInvoiceNew', 'format', 'inv-format', 'bottom'),
      s('salesInvoiceNew', 'search', 'sales-product-search', 'bottom'),
      s('salesInvoiceNew', 'location', 'sales-location-filter', 'bottom'),
      s('salesInvoiceNew', 'customer', 'sales-customer', 'left'),
      s('salesInvoiceNew', 'lines', 'sales-lines', 'left'),
      s('salesInvoiceNew', 'priceLevel', 'sales-price-level', 'left'),
      s('salesInvoiceNew', 'submit', 'sales-submit', 'top'),
      s('salesInvoiceNew', 'history', 'sales-history', 'bottom'),
    ],
  },
  salesInvoiceEdit: {
    module: 'pos',
    title: 'tour.pages.salesInvoiceEdit.title',
    path: '/sales/invoices/[id]/edit',
    steps: [
      s('salesInvoiceEdit', 'intro'),
      s('salesInvoiceEdit', 'reason', 'ie-reason', 'left'),
      s('salesInvoiceEdit', 'lines', 'sales-lines', 'left'),
      s('salesInvoiceEdit', 'search', 'sales-product-search', 'bottom'),
      s('salesInvoiceEdit', 'submit', 'sales-submit', 'top'),
    ],
  },
  salesInvoiceDetail: {
    module: 'pos',
    title: 'tour.pages.salesInvoiceDetail.title',
    path: '/sales/invoices/[id]',
    steps: [
      s('salesInvoiceDetail', 'intro'),
      s('salesInvoiceDetail', 'pay', 'id-pay', 'bottom'),
      s('salesInvoiceDetail', 'print', 'doc-print', 'bottom'),
      s('salesInvoiceDetail', 'toDelivery', 'id-to-do', 'bottom'),
      s('salesInvoiceDetail', 'reminder', 'id-reminder', 'bottom'),
      s('salesInvoiceDetail', 'edit', 'id-edit', 'bottom'),
      s('salesInvoiceDetail', 'void', 'id-void', 'bottom'),
    ],
  },
  salesQuotationNew: {
    module: 'pos',
    title: 'tour.pages.salesQuotationNew.title',
    path: '/sales/quotations/new',
    steps: [
      s('salesQuotationNew', 'intro'),
      s('salesQuotationNew', 'customer', 'sales-customer', 'left'),
      s('salesQuotationNew', 'search', 'sales-product-search', 'bottom'),
      s('salesQuotationNew', 'lines', 'sales-lines', 'left'),
      s('salesQuotationNew', 'priceLevel', 'sales-price-level', 'left'),
      s('salesQuotationNew', 'submit', 'sales-submit', 'top'),
      s('salesQuotationNew', 'history', 'sales-history', 'bottom'),
    ],
  },
  salesQuotationDetail: {
    module: 'pos',
    title: 'tour.pages.salesQuotationDetail.title',
    path: '/sales/quotations/[id]',
    steps: [
      s('salesQuotationDetail', 'intro'),
      s('salesQuotationDetail', 'edit', 'qd-edit', 'bottom'),
      s('salesQuotationDetail', 'send', 'qd-send', 'bottom'),
      s('salesQuotationDetail', 'accept', 'qd-accept', 'bottom'),
      s('salesQuotationDetail', 'toOrder', 'qd-to-order', 'bottom'),
      s('salesQuotationDetail', 'toInvoice', 'qd-to-invoice', 'bottom'),
      s('salesQuotationDetail', 'print', 'doc-print', 'bottom'),
    ],
  },
  salesOrderNew: {
    module: 'pos',
    title: 'tour.pages.salesOrderNew.title',
    path: '/sales/orders/new',
    steps: [
      s('salesOrderNew', 'intro'),
      s('salesOrderNew', 'customer', 'sales-customer', 'left'),
      s('salesOrderNew', 'search', 'sales-product-search', 'bottom'),
      s('salesOrderNew', 'lines', 'sales-lines', 'left'),
      s('salesOrderNew', 'priceLevel', 'sales-price-level', 'left'),
      s('salesOrderNew', 'submit', 'sales-submit', 'top'),
    ],
  },
  salesOrderDetail: {
    module: 'pos',
    title: 'tour.pages.salesOrderDetail.title',
    path: '/sales/orders/[id]',
    steps: [
      s('salesOrderDetail', 'intro'),
      s('salesOrderDetail', 'edit', 'od-edit', 'bottom'),
      s('salesOrderDetail', 'confirm', 'od-confirm', 'bottom'),
      s('salesOrderDetail', 'deliveries', 'od-deliveries', 'top'),
      s('salesOrderDetail', 'toInvoice', 'od-to-invoice', 'bottom'),
      s('salesOrderDetail', 'print', 'doc-print', 'bottom'),
    ],
  },

  // ── OPS / Warehouse ────────────────────────────────────────────────
  opsSession: {
    module: 'ops',
    title: 'tour.pages.opsSession.title',
    path: '/inventory/sessions/[id]',
    steps: [
      s('opsSession', 'intro'),
      s('opsSession', 'stages', 'ses-stages', 'bottom'),
      s('opsSession', 'receiveCheck', 'ses-receive-check'),
      s('opsSession', 'scan', 'ses-scan', 'top'),
      s('opsSession', 'next', 'ses-next', 'top'),
      s('opsSession', 'complete', 'ses-complete', 'top'),
      s('opsSession', 'cancel', 'ses-cancel', 'top'),
      s('opsSession', 'notes', 'ses-notes', 'top'),
    ],
  },
  opsLabels: {
    module: 'ops',
    title: 'tour.pages.opsLabels.title',
    path: '/inventory/labels',
    steps: [
      s('opsLabels', 'intro'),
      s('opsLabels', 'format', 'lbl-format', 'bottom'),
      s('opsLabels', 'settings', 'lbl-settings', 'bottom'),
      s('opsLabels', 'qty', 'lbl-qty', 'left'),
      s('opsLabels', 'itemPrint', 'lbl-item-print', 'left'),
      s('opsLabels', 'printAll', 'lbl-print-all', 'bottom'),
    ],
  },

  // ── Workshop ───────────────────────────────────────────────────────
  // Literal before '[id]'; the lookup page has no tour of its own.
  rmsVehicleLookup: { module: 'rms', title: 'tour.rms.title', path: '/workshop/vehicles/search', steps: [] },
  rmsVehicles: {
    module: 'rms',
    title: 'tour.pages.rmsVehicles.title',
    path: '/workshop/vehicles',
    steps: [
      s('rmsVehicles', 'intro'),
      s('rmsVehicles', 'search', 'veh-search', 'bottom'),
      s('rmsVehicles', 'row', 'veh-row', 'bottom'),
    ],
  },
  rmsVehicle: {
    module: 'rms',
    title: 'tour.pages.rmsVehicle.title',
    path: '/workshop/vehicles/[id]',
    steps: [
      s('rmsVehicle', 'intro'),
      s('rmsVehicle', 'newInvoice', 'veh-new-invoice', 'bottom'),
      s('rmsVehicle', 'stats', 'veh-stats', 'bottom'),
      s('rmsVehicle', 'filters', 'veh-filters', 'bottom'),
      s('rmsVehicle', 'visit', 'veh-visit', 'top'),
    ],
  },
  rmsReminders: {
    module: 'rms',
    title: 'tour.pages.rmsReminders.title',
    path: '/workshop/reminders',
    steps: [
      s('rmsReminders', 'intro'),
      s('rmsReminders', 'card', 'rem-card', 'bottom'),
      s('rmsReminders', 'complete', 'rem-complete', 'left'),
      s('rmsReminders', 'snooze', 'rem-snooze', 'left'),
    ],
  },

  // ── Delivery ───────────────────────────────────────────────────────
  deliveryRoutes: {
    module: 'delivery',
    title: 'tour.pages.deliveryRoutes.title',
    path: '/delivery/routes',
    steps: [
      s('deliveryRoutes', 'intro'),
      s('deliveryRoutes', 'filters', 'dlv-routes-filters', 'bottom'),
      s('deliveryRoutes', 'teams', 'dlv-routes-teams', 'bottom'),
      s('deliveryRoutes', 'invite', 'dlv-routes-invite', 'bottom'),
      s('deliveryRoutes', 'newRoute', 'dlv-routes-new', 'bottom'),
      s('deliveryRoutes', 'optimizeAll', 'dlv-routes-plan', 'bottom'),
      s('deliveryRoutes', 'list', 'dlv-routes-list', 'top'),
      s('deliveryRoutes', 'drivers', 'dlv-routes-drivers', 'bottom'),
    ],
  },
  deliveryPlan: {
    module: 'delivery',
    title: 'tour.pages.deliveryPlan.title',
    path: '/delivery/routes/plan',
    steps: [
      s('deliveryPlan', 'intro'),
      s('deliveryPlan', 'settings', 'dlv-plan-settings'),
      s('deliveryPlan', 'teams', 'dlv-plan-teams'),
      s('deliveryPlan', 'deliveries', 'dlv-plan-deliveries'),
      s('deliveryPlan', 'preview', 'dlv-plan-preview', 'top'),
    ],
  },
  deliveryRoute: {
    module: 'delivery',
    title: 'tour.pages.deliveryRoute.title',
    path: '/delivery/routes/[id]',
    steps: [
      s('deliveryRoute', 'intro'),
      s('deliveryRoute', 'map', 'dlv-route-map'),
      s('deliveryRoute', 'start', 'dlv-route-start', 'bottom'),
      s('deliveryRoute', 'departure', 'dlv-route-departure', 'bottom'),
      s('deliveryRoute', 'optimize', 'dlv-route-optimize', 'bottom'),
      s('deliveryRoute', 'addStop', 'dlv-route-add-stop', 'left'),
      s('deliveryRoute', 'stops', 'dlv-route-stops', 'top'),
      s('deliveryRoute', 'history', 'dlv-route-history', 'top'),
    ],
  },
  deliveryMonitoring: {
    module: 'delivery',
    title: 'tour.pages.deliveryMonitoring.title',
    path: '/delivery/monitoring',
    steps: [
      s('deliveryMonitoring', 'date', 'dlv-mon-date', 'bottom'),
      s('deliveryMonitoring', 'stats', 'dlv-mon-stats', 'bottom'),
      s('deliveryMonitoring', 'map', 'dlv-mon-map'),
      s('deliveryMonitoring', 'teams', 'dlv-mon-teams', 'top'),
    ],
  },
  deliveryDrivers: {
    module: 'delivery',
    title: 'tour.pages.deliveryDrivers.title',
    path: '/delivery/drivers',
    steps: [
      s('deliveryDrivers', 'intro'),
      s('deliveryDrivers', 'card', 'dlv-drivers-card', 'bottom'),
      s('deliveryDrivers', 'manage', 'dlv-drivers-manage', 'left'),
      s('deliveryDrivers', 'lock', 'dlv-drivers-lock', 'left'),
    ],
  },
};

export { s as pageStep };
