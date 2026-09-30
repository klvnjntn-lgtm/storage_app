// src/routing/osrm.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type LatLng = { lat: number; lng: number };

export type TripLeg = { distanceMeters: number; durationSeconds: number };

// Full point-to-point travel matrix: durations[i][j] / distances[i][j] is
// travel FROM points[i] TO points[j], rounded to whole seconds/meters
// (VROOM only accepts integers).
export type TravelMatrix = { durations: number[][]; distances: number[][] };

// Result of optimizing [start, ...stops]: the stop order re-sequenced for
// shortest total travel, and the leg arriving at each one in that order.
export type TripResult = {
  // Indices into the ORIGINAL `stops` array (excluding the start point),
  // in visiting order.
  order: number[];
  // legs[i] is the travel FROM the previous point TO order[i] (or from
  // the start point, for legs[0]) — same length and order as `order`.
  legs: TripLeg[];
};

// Internal OSRM /trip response shapes (only the fields this service reads).
type OsrmWaypoint = { waypoint_index: number };
type OsrmLeg = { distance: number; duration: number };
type OsrmTripResponse = {
  code: string;
  message?: string;
  waypoints?: OsrmWaypoint[];
  trips?: { legs: OsrmLeg[] }[];
};
type OsrmTableResponse = {
  code: string;
  message?: string;
  durations?: (number | null)[][];
  distances?: (number | null)[][];
  // How far (m) each input point had to move to reach the nearest road.
  sources?: { distance: number }[];
};
type OsrmRouteResponse = {
  code: string;
  message?: string;
  routes?: { legs: OsrmLeg[] }[];
};

// A hung OSRM must not hold a request (and its DB connection) open
// indefinitely — fail fast into the ServiceUnavailableException path.
const OSRM_TIMEOUT_MS = 15_000;

// A pin further than this from any road is treated as unreachable rather
// than silently snapped — OSRM will happily "route" a pin dropped in the
// sea or in another country to the nearest road in the extract.
const MAX_SNAP_METERS = 1000;

// Indices (into the points passed to table()) that have no road route to
// or from the others, or sit too far from any road.
export class UnreachablePointsError extends Error {
  constructor(public readonly indices: number[]) {
    super(`No road route to points: ${indices.join(', ')}`);
  }
}

@Injectable()
export class OsrmService {
  private readonly baseUrl = process.env.OSRM_URL ?? 'http://osrm:5000';

  // `points[0]` MUST be the route's start/depot point.
  //
  // Verified live against this OSRM build (v5.26.0): `roundtrip=false`
  // only works when BOTH source AND destination are fixed
  // (`source=first&destination=last`) — a "fixed start, free end" open
  // path (what a delivery route actually is: no need to return to the
  // depot) returns `{"code":"NotImplemented"}` for any other combination,
  // including source=first alone. The standard workaround, used here: ask
  // for a closed `roundtrip=true` loop (source=first pins the depot as
  // the start) and drop the final "return to depot" leg — the visiting
  // order for the real stops is unaffected, only that trailing leg is
  // discarded.
  async trip(points: LatLng[]): Promise<TripResult> {
    if (points.length < 2) {
      return { order: [], legs: [] };
    }

    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.baseUrl}/trip/v1/driving/${coords}?source=first&roundtrip=true&overview=false`;

    const body = await this.request<OsrmTripResponse>(url);

    const waypoints = body.waypoints ?? [];
    const trip = body.trips?.[0];
    if (!trip) {
      throw new ServiceUnavailableException('Route optimization service returned no trip');
    }

    // waypoints[i] is INPUT point i; .waypoint_index is its position in
    // the optimized visiting order. Invert that to get, per visiting
    // position, which input point it is — then drop position 0 (the
    // start point, forced first by source=first) and shift the rest back
    // into indices relative to `points` excluding the start.
    const inputIndexByVisitPosition: number[] = [];
    waypoints.forEach((wp, inputIndex) => {
      inputIndexByVisitPosition[wp.waypoint_index] = inputIndex;
    });

    const order = inputIndexByVisitPosition.slice(1).map((inputIndex) => inputIndex - 1);
    // trip.legs has N entries for a roundtrip of N points (the closed
    // loop back to the depot) — drop the last one, which is that return
    // leg, not travel to a real stop.
    const legs = trip.legs.slice(0, -1).map((leg) => ({ distanceMeters: leg.distance, durationSeconds: leg.duration }));

    return { order, legs };
  }

  // Travel legs for visiting `points` in exactly the given order (no
  // re-sequencing) — used after a manual reorder, where the order is the
  // dispatcher's choice and only the legs/ETAs need recomputing.
  // legs[i] is the travel from points[i] to points[i + 1].
  async route(points: LatLng[]): Promise<TripLeg[]> {
    if (points.length < 2) return [];

    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.baseUrl}/route/v1/driving/${coords}?overview=false`;
    const body = await this.request<OsrmRouteResponse>(url);

    const route = body.routes?.[0];
    if (!route) {
      throw new ServiceUnavailableException('Route optimization service returned no route');
    }
    return route.legs.map((leg) => ({ distanceMeters: leg.distance, durationSeconds: leg.duration }));
  }

  // One /table call for every pair of points — the input VROOM optimizes
  // over. A null cell means OSRM found no road between the two points
  // (e.g. a pin dropped on an island with no ferry in the extract); it's
  // reported as unreachable rather than silently treated as zero.
  async table(points: LatLng[]): Promise<TravelMatrix> {
    if (points.length === 0) return { durations: [], distances: [] };
    if (points.length === 1) return { durations: [[0]], distances: [[0]] };

    const coords = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = `${this.baseUrl}/table/v1/driving/${coords}?annotations=duration,distance`;
    const body = await this.request<OsrmTableResponse>(url);

    if (!body.durations || !body.distances) {
      throw new ServiceUnavailableException('Routing service returned no travel matrix');
    }
    // points[0] is always the depot/start: a point with no road to or from
    // it is the unreachable one. A leftover gap between two otherwise
    // reachable stops flags both.
    const d = body.durations;
    const unreachable = new Set<number>();
    body.sources?.forEach((src, j) => {
      if (j > 0 && src.distance > MAX_SNAP_METERS) unreachable.add(j);
    });
    for (let j = 1; j < d.length; j++) {
      if (d[0][j] == null || d[j][0] == null) unreachable.add(j);
    }
    d.forEach((row, i) =>
      row.forEach((v, j) => {
        if (v == null && !unreachable.has(i) && !unreachable.has(j)) {
          unreachable.add(i);
          unreachable.add(j);
        }
      }),
    );
    const round = (m: (number | null)[][]) => m.map((row) => row.map((v) => Math.round(v ?? 0)));
    const matrix = { durations: round(body.durations), distances: round(body.distances) };
    if (unreachable.size > 0) {
      throw new UnreachablePointsError([...unreachable].sort((a, b) => a - b));
    }
    return matrix;
  }

  private async request<T extends { code: string; message?: string }>(url: string): Promise<T> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
      const body = (await res.json()) as T;
      if (!res.ok || body.code !== 'Ok') {
        throw new Error(body.message ?? `OSRM returned ${body.code ?? res.status}`);
      }
      return body;
    } catch (err) {
      throw new ServiceUnavailableException(
        `Route optimization service is unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
