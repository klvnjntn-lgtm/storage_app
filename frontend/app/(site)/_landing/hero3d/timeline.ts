import { CatmullRomCurve3, Vector3 } from 'three';
import type { SolutionKey } from '../solutions';

/* ─── Hero story, as pure functions of loop time ────────────────────
   One 24s loop following one order through the whole business, so the
   warehouse reads as part of a bigger operation:
     warehouse  a crate lands on the dock, gets scanned and shelved
     sales      the counter prints an invoice; the order flies to the shelf
     delivery   the AGV loads the crate onto the truck, and it drives off
     workshop   a car on the lift finishes its service and comes down
   Everything here is deterministic so the reduced-motion render can just
   evaluate one frame. World units ≈ metres; +y up, +z toward camera. */

export const LOOP = 24;
/** Frame shown when motion is reduced: truck loaded, car up on the lift. */
export const STATIC_T = 15.3;

// Racks: a long row across the back (A) and a shorter one down the left
// side (B), both opening onto the floor the camera looks at, so the AGV
// never drives out of sight. Bays are 1.2m wide.
export const BAY_W = 1.2;
export const RACK_DEPTH = 0.7;
export const RACK_H = 2.2;
/** Top surface of each shelf level. */
export const LEVELS = [0.12, 0.82, 1.52];

export type RowId = 'A' | 'B';
/** origin: row centre line at the start of bay 0; along: bay direction; face: open side. */
export type Row = { origin: [number, number]; along: [number, number]; face: [number, number]; bays: number };
export const ROWS: Record<RowId, Row> = {
  A: { origin: [-3.4, -2.6], along: [1, 0], face: [0, 1], bays: 5 },
  B: { origin: [-4.4, -1.6], along: [0, 1], face: [1, 0], bays: 4 },
};

/** Row-local (u along, w toward the open side) → world x/z. */
export function rowXZ(row: Row, u: number, w: number): [number, number] {
  return [row.origin[0] + row.along[0] * u + row.face[0] * w, row.origin[1] + row.along[1] * u + row.face[1] * w];
}

/** Bin code: row, then level and bay counted from 1 — A-23 is row A, level 2, bay 3. */
export const slotLabel = (row: RowId, bay: number, level: number) => `${row}-${level + 1}${bay + 1}`;

export type Slot = { row: RowId; bay: number; level: number; label: string; pos: Vector3; front: Vector3; face: Vector3 };
function slotAt(row: RowId, bay: number, level: number): Slot {
  const r = ROWS[row];
  const [x, z] = rowXZ(r, BAY_W * (bay + 0.5), 0);
  const [fx, fz] = rowXZ(r, BAY_W * (bay + 0.5), RACK_DEPTH / 2 + 0.65);
  return { row, bay, level, label: slotLabel(row, bay, level), pos: new Vector3(x, LEVELS[level], z), front: new Vector3(fx, 0, fz), face: new Vector3(r.face[0], 0, r.face[1]) };
}

export const CRATE = { w: 0.56, h: 0.42, d: 0.5 };
export const DECK_REST = 0.34;
export const DECK_UP = LEVELS[1];

export const SLOT_PICK = slotAt('A', 2, 1);
export const SLOT_LOW = slotAt('A', 4, 2);

// Dock: crate lands under the scan arch, the conveyor feeds it -z onto
// the AGV parked beside it.
export const DOCK_LAND = new Vector3(2.5, DECK_REST, 2.85);
export const AGV_HOME = new Vector3(2.5, 0, 1.5);

const curve = (pts: [number, number][]) =>
  new CatmullRomCurve3(
    pts.map(([x, z]) => new Vector3(x, 0, z)),
    false,
    'centripetal',
  );
const xz = (v: Vector3): [number, number] => [v.x, v.z];

// Delivery bay: a road down the right edge. The truck noses toward -z, so
// its open tail faces the AGV's loading spot.
export const ROAD = { x: 5.2, z0: -3.45, z1: 5.15, w: 1.6 };
export const TRUCK_LEN = 2.8;
export const LOAD_AT = new Vector3(ROAD.x, 0, TRUCK_LEN / 2 + 0.95);
export const CARGO_FLOOR = 0.56;

export const COUNTER = new Vector3(-1.0, 0, 0.8);
export const PRINTER_TOP = new Vector3(COUNTER.x + 0.45, 0.98, COUNTER.z);
export const LIFT = { x: -1.6, z: 3.5, rise: 0.8 };

const LEG_PUTAWAY = curve([xz(AGV_HOME), [3.0, 0.3], [2.0, -1.45], xz(SLOT_PICK.front)]);
const LEG_LOAD = curve([xz(SLOT_PICK.front), [1.4, -1.0], [3.4, 0.8], [3.9, 2.5], xz(LOAD_AT)]);
const LEG_RETURN = curve([xz(LOAD_AT), [4.1, 1.5], [3.2, 1.05], xz(AGV_HOME)]);
/** Robot lanes painted on the floor. */
export const LANES = [LEG_PUTAWAY, LEG_LOAD, LEG_RETURN];

// Key times (s).
export const T = {
  landed: 1.0,
  scanStart: 1.0,
  scanned: 1.8,
  scanEnd: 2.2,
  onAgv: 3.0,
  atSlot: 6.2,
  stored: 7.1,
  printStart: 7.5,
  paid: 8.7,
  orderSent: 9.0,
  orderAtShelf: 10.4,
  pickDone: 11.3,
  loadStart: 11.7,
  atTruck: 14.2,
  loaded: 15.2,
  returnStart: 15.6,
  home: 17.8,
  truckIn: 1.0,
  truckParked: 4.0,
  truckOut: 15.6,
  truckGone: 18.6,
  serviced: 19.2,
  liftDown: 20.6,
  liftUpStart: 22.6,
  liftUp: 23.8,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const easeInOut = (v: number) => 0.5 - Math.cos(Math.PI * v) / 2;
const easeOutBounce = (v: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (v < 1 / d) return n * v * v;
  if (v < 2 / d) return n * (v -= 1.5 / d) * v + 0.75;
  if (v < 2.5 / d) return n * (v -= 2.25 / d) * v + 0.9375;
  return n * (v -= 2.625 / d) * v + 0.984375;
};
const lerp = (a: number, b: number, v: number) => a + (b - a) * v;

/** Progress 0..1 of the delivery card's route bar. */
export const routeProgress = (t: number) => span(t, T.truckOut, T.truckGone);

/** Height the car has risen on the lift: up by default, down once serviced. */
export const liftHeight = (t: number) =>
  LIFT.rise * (1 - easeInOut(span(t, T.serviced, T.liftDown)) + easeInOut(span(t, T.liftUpStart, T.liftUp)));

/** Truck z along the road and its scale (it fades in/out at the platform edges). */
export function truckPose(t: number) {
  if (t < T.truckIn || t >= T.truckGone) return { z: 0, scale: 0 };
  if (t < T.truckParked) {
    const v = span(t, T.truckIn, T.truckParked);
    const eased = 1 - (1 - v) * (1 - v) * (1 - v);
    return { z: lerp(ROAD.z1 - 0.2, 0, eased), scale: easeInOut(span(v, 0, 0.3)) };
  }
  if (t < T.truckOut) return { z: 0, scale: 1 };
  const v = span(t, T.truckOut, T.truckGone);
  return { z: lerp(0, ROAD.z0 + 0.2, v * v), scale: 1 - easeInOut(span(v, 0.72, 1)) };
}

/** The invoice's order sheet: rises from the printer, then arcs to the shelf. */
export function orderSheet(t: number, out: Vector3) {
  if (t < T.printStart || t >= T.orderAtShelf) return 0;
  if (t < T.orderSent) {
    out.copy(PRINTER_TOP).setY(PRINTER_TOP.y + 0.34 * easeInOut(span(t, T.printStart, T.paid)));
    return 1;
  }
  const v = easeInOut(span(t, T.orderSent, T.orderAtShelf));
  out.lerpVectors(PRINTER_TOP, SLOT_PICK.pos, v);
  out.y += 0.34 * (1 - v) + Math.sin(v * Math.PI) * 1.1 + v * 0.6;
  return 1 - span(v, 0.85, 1);
}

export type AgvPose = { pos: Vector3; dir: Vector3; deck: number; moving: boolean };

function onLeg(leg: CatmullRomCurve3, v: number, out: AgvPose) {
  const u = easeInOut(v);
  leg.getPointAt(u, out.pos);
  leg.getTangentAt(Math.min(0.999, Math.max(0.001, u)), out.dir);
  out.moving = v > 0 && v < 1;
}

/** Deck height: lifts to shelf level while parked at a slot. */
function deckAt(t: number) {
  const lift = (up: number, down: number) =>
    easeInOut(span(t, up, up + 0.4)) - easeInOut(span(t, down, down + 0.4));
  const v = Math.max(lift(T.atSlot, T.stored), lift(T.orderAtShelf, T.pickDone), lift(T.atTruck, T.loaded));
  return lerp(DECK_REST, DECK_UP, v);
}

export function agvPose(t: number, out: AgvPose) {
  out.deck = deckAt(t);
  if (t < T.onAgv) {
    out.pos.copy(AGV_HOME);
    out.dir.set(1, 0, 0);
    out.moving = false;
  } else if (t < T.atSlot) onLeg(LEG_PUTAWAY, span(t, T.onAgv, T.atSlot), out);
  else if (t < T.loadStart) onLeg(LEG_PUTAWAY, 1, out);
  else if (t < T.atTruck) onLeg(LEG_LOAD, span(t, T.loadStart, T.atTruck), out);
  else if (t < T.returnStart) onLeg(LEG_LOAD, 1, out);
  else if (t < T.home) onLeg(LEG_RETURN, span(t, T.returnStart, T.home), out);
  else onLeg(LEG_RETURN, 1, out);
  return out;
}

/** Crate centre and scale. Reads the AGV pose for the riding segments. */
export function cratePose(t: number, agv: AgvPose, out: Vector3): number {
  const half = CRATE.h / 2;
  // 0 = at the AGV in front of the slot, 1 = on the shelf
  const slot = (s: Slot, v: number) => out.lerpVectors(s.front, s.pos, easeInOut(v)).setY(s.pos.y + half);
  if (t < T.landed) {
    const v = span(t, 0, T.landed);
    out.set(DOCK_LAND.x, lerp(3.2, DOCK_LAND.y + half, easeOutBounce(v)), DOCK_LAND.z);
    return clamp01(v * 4);
  }
  if (t < T.scanEnd) {
    out.set(DOCK_LAND.x, DOCK_LAND.y + half, DOCK_LAND.z);
  } else if (t < T.onAgv) {
    out.set(DOCK_LAND.x, DECK_REST + half, lerp(DOCK_LAND.z, AGV_HOME.z, easeInOut(span(t, T.scanEnd, T.onAgv))));
  } else if (t < T.atSlot + 0.4) {
    out.set(agv.pos.x, agv.deck + half, agv.pos.z);
  } else if (t < T.pickDone) {
    // shelved after T.stored, slides back out once the order reaches the shelf
    slot(SLOT_PICK, Math.min(span(t, T.atSlot + 0.4, T.stored), 1 - span(t, T.orderAtShelf + 0.4, T.pickDone)));
  } else if (t < T.atTruck + 0.4) {
    out.set(agv.pos.x, agv.deck + half, agv.pos.z);
  } else if (t < T.loaded) {
    // off the deck and in through the truck's open tail
    const v = easeInOut(span(t, T.atTruck + 0.4, T.loaded));
    out.set(LOAD_AT.x, lerp(DECK_UP + half, CARGO_FLOOR + half, v), lerp(LOAD_AT.z, TRUCK_LEN / 2 - 0.5, v));
  } else {
    return 0; // inside the truck, out of sight
  }
  return 1;
}

/** Scan laser height over the crate, or null when idle. */
export function scanLaser(t: number) {
  if (t < T.scanStart || t > T.scanEnd) return null;
  const v = span(t, T.scanStart, T.scanEnd);
  return DECK_REST + 0.05 + Math.abs(Math.sin(v * Math.PI * 1.5)) * (CRATE.h + 0.25);
}

/** 0..1 flash right after a moment, for glows. */
export const flash = (t: number, at: number, len = 0.9) =>
  t < at || t > at + len ? 0 : 1 - (t - at) / len;

export type Phase = {
  zone: SolutionKey;
  scanned: boolean;
  stored: boolean;
  printing: boolean;
  paid: boolean;
  loaded: boolean;
  delivered: boolean;
  serviced: boolean;
};

export const zoneAt = (t: number): SolutionKey =>
  t < T.printStart ? 'warehouse' : t < T.orderAtShelf ? 'sales' : t < T.truckGone ? 'delivery' : 'workshop';

export const phaseAt = (t: number): Phase => ({
  zone: zoneAt(t),
  scanned: t >= T.scanned,
  stored: t >= T.stored,
  printing: t >= T.printStart && t < T.paid,
  paid: t >= T.paid,
  loaded: t >= T.loaded,
  delivered: t >= T.truckGone,
  serviced: t >= T.serviced,
});
