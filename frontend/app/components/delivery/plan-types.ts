// Shapes returned by the "optimize all teams" endpoints
// (/delivery-routes/plan/*) and the per-route optimize's `unscheduled`.

export type UnscheduledReason = 'NO_PIN' | 'UNREACHABLE' | 'OUTSIDE_WINDOW' | 'NO_TIME';

export type Priority = 'NORMAL' | 'HIGH';

export type PlanCandidates = {
  routeDate: string;
  defaultDepot: { latitude: number; longitude: number } | null;
  teams: {
    id: string;
    name: string;
    driver: { id: string; email: string; displayName: string | null } | null;
    hours: string | null;
    restricted: boolean;
    offDuty: boolean;
    routes: { id: string; status: string; locked: boolean; stopCount: number }[];
  }[];
  deliveryOrders: {
    id: string;
    doNumber: string | null;
    customerName: string | null;
    deliveryAddress: string | null;
    priority: Priority;
    deliveryWindowStart: string | null;
    deliveryWindowEnd: string | null;
    hasPin: boolean;
    currentRoute: { id: string; teamId: string } | null;
  }[];
};

export type PlanPreview = {
  routeDate: string;
  depot: { latitude: number; longitude: number };
  routes: {
    team: { id: string; name: string; driver: { id: string; email: string; displayName: string | null } | null };
    hours: string | null;
    offDuty: boolean;
    departureAt: string;
    existingRouteId: string | null;
    totalMeters: number;
    totalSeconds: number;
    finishEta: string | null;
    stops: {
      sequence: number;
      deliveryOrderId: string;
      doNumber: string | null;
      customerName: string | null;
      deliveryAddress: string | null;
      priority: Priority;
      deliveryWindowStart: string | null;
      deliveryWindowEnd: string | null;
      latitude: number;
      longitude: number;
      eta: string | null;
      travelSeconds: number | null;
      travelMeters: number | null;
      movedFromRouteId: string | null;
    }[];
  }[];
  unassigned: {
    deliveryOrderId: string;
    label: string;
    priority: Priority;
    reason: UnscheduledReason;
    currentRouteId: string | null;
  }[];
  removedDeliveryOrderIds: string[];
  cancelledRouteIds: string[];
  expectedVersions: Record<string, number>;
};
