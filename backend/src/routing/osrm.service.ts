// src/routing/osrm.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type LatLng = { lat: number; lng: number };

export type TripLeg = { distanceMeters: number; durationSeconds: number };

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

    let body: OsrmTripResponse;
    try {
      const res = await fetch(url);
      body = await res.json();
      if (!res.ok || body.code !== 'Ok') {
        throw new Error(body.message ?? `OSRM returned ${body.code ?? res.status}`);
      }
    } catch (err) {
      throw new ServiceUnavailableException(
        `Route optimization service is unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
}
