// src/routing/vroom.service.ts
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { TravelMatrix } from './osrm.service';

// VROOM (vroom-express) is the vehicle-routing optimizer: given drivers,
// deliveries and a travel matrix, it decides which driver takes which
// delivery and in what order. It never talks to OSRM itself — the caller
// passes the matrix from OsrmService.table(), so OSRM stays the single
// source of road/travel data.
//
// All times are whole seconds relative to a caller-chosen base instant
// (VROOM has no notion of dates); location indices point into the matrix.

export type VroomVehicle = {
  id: number;
  startIndex: number;
  // [earliest start, latest end] of the driver's working hours. Omitted =
  // unrestricted. No end location: a route ends at its last delivery.
  timeWindow?: [number, number];
};

export type VroomJob = {
  id: number;
  locationIndex: number;
  serviceSeconds: number;
  // 0–100. When not every delivery fits, VROOM keeps higher-priority jobs
  // first. It does NOT force them earlier in the visiting order.
  priority: number;
  timeWindow?: [number, number];
};

export type VroomSolution = {
  // One entry per vehicle that got at least one job, jobs in visiting order.
  routes: { vehicleId: number; jobIds: number[] }[];
  unassignedJobIds: number[];
};

type VroomResponse = {
  code: number;
  error?: string;
  unassigned?: { id: number }[];
  routes?: { vehicle: number; steps: { type: string; id?: number }[] }[];
};

const VROOM_TIMEOUT_MS = 30_000;

@Injectable()
export class VroomService {
  private readonly baseUrl = process.env.VROOM_URL ?? 'http://vroom:3000';

  async solve(input: {
    vehicles: VroomVehicle[];
    jobs: VroomJob[];
    matrix: TravelMatrix;
  }): Promise<VroomSolution> {
    if (input.jobs.length === 0 || input.vehicles.length === 0) {
      return { routes: [], unassignedJobIds: input.jobs.map((j) => j.id) };
    }

    const problem = {
      vehicles: input.vehicles.map((v) => ({
        id: v.id,
        profile: 'car',
        start_index: v.startIndex,
        ...(v.timeWindow ? { time_window: v.timeWindow } : {}),
      })),
      jobs: input.jobs.map((j) => ({
        id: j.id,
        location_index: j.locationIndex,
        service: j.serviceSeconds,
        priority: j.priority,
        ...(j.timeWindow ? { time_windows: [j.timeWindow] } : {}),
      })),
      matrices: { car: input.matrix },
    };

    let body: VroomResponse;
    try {
      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(problem),
        signal: AbortSignal.timeout(VROOM_TIMEOUT_MS),
      });
      body = (await res.json()) as VroomResponse;
      if (!res.ok || body.code !== 0) {
        throw new Error(body.error ?? `VROOM returned code ${body.code ?? res.status}`);
      }
    } catch (err) {
      throw new ServiceUnavailableException(
        `Route optimization service is unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      routes: (body.routes ?? []).map((r) => ({
        vehicleId: r.vehicle,
        jobIds: r.steps.filter((s) => s.type === 'job' && s.id != null).map((s) => s.id!),
      })),
      unassignedJobIds: (body.unassigned ?? []).map((u) => u.id),
    };
  }
}
