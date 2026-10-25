import { CatmullRomCurve3, Vector3 } from 'three';

/* ─── Hero story, as pure functions of loop time ────────────────────
   One 18s loop, the same Receive → Move → Track as "How it works":
     receive  a crate drops onto the dock conveyor and gets scanned
     putaway  the AGV carries it down the aisle into A-03
     move     a transfer pulls it back out and re-slots it in B-11
     track    the feed logs both, and a low-stock alert fires
   Everything here is deterministic so the reduced-motion render can just
   evaluate one frame. World units ≈ metres; +y up, +z toward camera. */

export const LOOP = 18;
/** Frame shown when motion is reduced: every event has happened. */
export const STATIC_T = 14;

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

export const SLOT_A03 = slotAt('A', 2, 1);
export const SLOT_B11 = slotAt('B', 1, 1);
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

const LEG_PUTAWAY = curve([xz(AGV_HOME), [3.0, 0.3], [2.0, -1.45], xz(SLOT_A03.front)]);
const LEG_MOVE = curve([xz(SLOT_A03.front), [-2.3, -1.6], [-3.3, -0.9], xz(SLOT_B11.front)]);
const LEG_RETURN = curve([xz(SLOT_B11.front), [-3.2, 1.7], [-2.0, 2.4], [0.6, 2.3], [1.7, 1.6], xz(AGV_HOME)]);
/** Robot lanes painted on the floor. */
export const LANES = [LEG_PUTAWAY, LEG_MOVE, LEG_RETURN];

// Key times (s).
export const T = {
  landed: 1.0,
  scanStart: 1.0,
  scanned: 1.8,
  scanEnd: 2.2,
  onAgv: 3.0,
  atA03: 6.2,
  putaway: 7.1,
  moveStart: 8.5,
  atB11: 11.0,
  moved: 11.9,
  alert: 12.6,
  returnStart: 12.3,
  home: 16.6,
  fadeStart: 17.2,
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

/** Progress 0..1 of the transfer card's bar. */
export const moveProgress = (t: number) => span(t, T.moveStart, T.moved);

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
  const v = Math.max(lift(T.atA03, 7.1), lift(T.moveStart, 9.4), lift(T.atB11, T.moved));
  return lerp(DECK_REST, DECK_UP, v);
}

export function agvPose(t: number, out: AgvPose) {
  out.deck = deckAt(t);
  if (t < T.onAgv) {
    out.pos.copy(AGV_HOME);
    out.dir.set(1, 0, 0);
    out.moving = false;
  } else if (t < T.atA03) onLeg(LEG_PUTAWAY, span(t, T.onAgv, T.atA03), out);
  else if (t < 9.8) onLeg(LEG_PUTAWAY, 1, out);
  else if (t < T.atB11) onLeg(LEG_MOVE, span(t, 9.8, T.atB11), out);
  else if (t < T.returnStart) onLeg(LEG_MOVE, 1, out);
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
  } else if (t < 6.6 || (t >= 9.4 && t < 11.4)) {
    out.set(agv.pos.x, agv.deck + half, agv.pos.z);
  } else if (t < 9.4) {
    slot(SLOT_A03, Math.min(span(t, 6.6, T.putaway), 1 - span(t, 8.9, 9.4)));
  } else {
    slot(SLOT_B11, span(t, 11.4, T.moved));
  }
  return 1 - easeInOut(span(t, T.fadeStart, LOOP));
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

export type Phase = { scanned: boolean; stored: boolean; moving: boolean; moved: boolean; alert: boolean };

export const phaseAt = (t: number): Phase => ({
  scanned: t >= T.scanned,
  stored: t >= T.putaway,
  moving: t >= T.moveStart && t < T.moved,
  moved: t >= T.moved,
  alert: t >= T.alert,
});
