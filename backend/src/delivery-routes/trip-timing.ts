// src/delivery-routes/trip-timing.ts
import { Injectable } from '@nestjs/common';
import { RouteStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OsrmService } from '../routing/osrm.service';
import { RouteOptimizerService } from './route-optimizer.service';
import { stopSelect } from './delivery-routes.service';
import { UpdateTripTimingDto } from './dto/trip-timing.dto';

// ETAs come from OSRM's road data, which knows nothing about Batam's traffic,
// parking or how long a drop takes. This learns both from the business's own
// deliveries: between two deliveries in a row, the time that passed should be
//   gap = travelFactor × road time + stop time.
// Stop time comes from pairs of neighbours (almost no driving), the factor
// from pairs further apart once stop time is taken off. Medians throughout,
// so a lunch break or a wrong turn doesn't drag the answer.

// How far back to look, and how many recent routes to read at most (one
// OSRM call each).
const LOOKBACK_DAYS = 60;
const MAX_ROUTES = 60;
// Several delivery orders dropped at one stop come seconds apart: not a trip.
const MIN_GAP_S = 60;
// A gap this long held a break, a reload or a long wait: not a trip either.
const MAX_GAP_S = 90 * 60;
// Neighbours: road time this short says the gap is nearly all stop time.
const NEIGHBOUR_ROAD_S = 90;
// Pairs far enough apart for the road time to dominate.
const TRIP_ROAD_S = 240;
// Fewer pairs than this and the answer isn't worth suggesting.
const MIN_NEIGHBOUR_PAIRS = 10;
const MIN_TRIP_PAIRS = 15;

export type TimingPair = { roadSeconds: number; gapSeconds: number };

export type TimingSuggestion = {
  travelFactor: number | null;
  stopMinutes: number | null;
  neighbourPairs: number;
  tripPairs: number;
  routes: number;
  sinceDate: string;
};

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// The fit itself (see the top of this file). `currentStopSeconds` stands in
// for stop time when there are too few neighbour pairs to measure it.
export function fitTiming(pairs: TimingPair[], currentStopSeconds: number) {
  const usable = pairs.filter((p) => p.gapSeconds >= MIN_GAP_S && p.gapSeconds <= MAX_GAP_S);
  const neighbours = usable.filter((p) => p.roadSeconds <= NEIGHBOUR_ROAD_S);
  const trips = usable.filter((p) => p.roadSeconds >= TRIP_ROAD_S);

  const stopSeconds =
    neighbours.length >= MIN_NEIGHBOUR_PAIRS
      ? Math.min(30 * 60, Math.max(60, median(neighbours.map((p) => p.gapSeconds - p.roadSeconds))))
      : null;
  const stop = stopSeconds ?? currentStopSeconds;
  const factor =
    trips.length >= MIN_TRIP_PAIRS
      ? Math.min(3, Math.max(0.8, median(trips.map((p) => (p.gapSeconds - stop) / p.roadSeconds))))
      : null;

  return {
    travelFactor: factor == null ? null : Math.round(factor * 20) / 20,
    stopMinutes: stopSeconds == null ? null : Math.round(stopSeconds / 60),
    neighbourPairs: neighbours.length,
    tripPairs: trips.length,
  };
}

@Injectable()
export class TripTimingService {
  constructor(
    private prisma: PrismaService,
    private osrm: OsrmService,
    private optimizer: RouteOptimizerService,
  ) {}

  async get(organizationId: string) {
    const timing = await this.optimizer.timing(organizationId);
    return {
      travelFactor: timing.travelFactor,
      stopMinutes: Math.round(timing.dwellSeconds / 60),
    };
  }

  async set(organizationId: string, dto: UpdateTripTimingDto) {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { deliveryTravelTimeFactor: dto.travelFactor, deliveryStopMinutes: dto.stopMinutes },
    });
    return this.get(organizationId);
  }

  // Pairs of deliveries the driver recorded one after the other on the same
  // route, with the road time between where each was recorded.
  async suggest(organizationId: string): Promise<TimingSuggestion> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000);
    const routes = await this.prisma.route.findMany({
      where: { organizationId, routeDate: { gte: since }, status: { not: RouteStatus.CANCELLED } },
      select: { id: true, stops: { select: stopSelect } },
      orderBy: { routeDate: 'desc' },
      take: MAX_ROUTES,
    });

    const pairs: TimingPair[] = [];
    let used = 0;
    for (const route of routes) {
      const visits = route.stops
        .filter((s) => s.markedByOfficeAt == null)
        .map((s) => {
          const d = s.deliveryOrder;
          const at = d ? d.signedAt : s.signedAt;
          const lat = d ? d.completedLatitude : s.completedLatitude;
          const lng = d ? d.completedLongitude : s.completedLongitude;
          return at && lat != null && lng != null
            ? { at: at.getTime(), lat: Number(lat), lng: Number(lng) }
            : null;
        })
        .filter((v): v is { at: number; lat: number; lng: number } => v != null)
        .sort((a, b) => a.at - b.at);
      if (visits.length < 2) continue;
      let matrix;
      try {
        // Unscaled on purpose: the factor is what's being measured.
        matrix = await this.osrm.table(visits.map((v) => ({ lat: v.lat, lng: v.lng })));
      } catch {
        continue; // a reading off the road network: skip the route, not the answer
      }
      used++;
      for (let i = 1; i < visits.length; i++) {
        pairs.push({
          roadSeconds: matrix.durations[i - 1][i],
          gapSeconds: (visits[i].at - visits[i - 1].at) / 1000,
        });
      }
    }

    const current = await this.optimizer.timing(organizationId);
    return {
      ...fitTiming(pairs, current.dwellSeconds),
      routes: used,
      sinceDate: since.toISOString().slice(0, 10),
    };
  }
}
