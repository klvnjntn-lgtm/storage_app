'use client';

import { memo, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Grid, Instance, Instances, Line, RoundedBox } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Line2 } from 'three-stdlib';
import { BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, MeshBasicMaterial, Vector3 } from 'three';
import {
  BAY_W,
  DECK_REST,
  DOCK_LAND,
  LANES,
  LEVELS,
  RACK_DEPTH,
  RACK_H,
  ROWS,
  SLOT_A03,
  SLOT_B11,
  SLOT_LOW,
  rowXZ,
  slotLabel,
  type Row,
  type RowId,
  type Slot,
} from './timeline';

/* ─── Static diorama: platform, racks, stock, dock ──────────────────
   Repeated parts are instanced so the whole set is a handful of draw
   calls. Stock layout is seeded, so every visit sees the same racks. */

const PLATFORM = { w: 10.8, d: 7 };
const CRATE_COLORS = ['#b98a55', '#a87b4a', '#c79a63', '#2563eb', '#475569', '#1d4ed8'];

function seeded(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

type V3 = [number, number, number];
type Box = { p: V3; s: V3; c?: string };

const PARTS = [
  ['BRK', 'brakePads'],
  ['FLT', 'oilFilter'],
  ['BLT', 'timingBelt'],
  ['SPK', 'sparkPlug'],
  ['BRG', 'wheelBearing'],
  ['CLT', 'clutchKit'],
] as const;
export type PartKey = (typeof PARTS)[number][1];

/** What the hover card shows for a stocked box. */
export type StockInfo = { id: number; sku: string; part: PartKey; loc: string; qty: number; low: boolean; top: V3; center: V3; size: V3 };
type Crate = Box & { info: StockInfo };

function rackParts() {
  const uprights: Box[] = [];
  const beams: Box[] = [];
  const decks: Box[] = [];
  const crates: Crate[] = [];
  const reserved = [SLOT_A03, SLOT_B11];
  let n = 0;

  for (const [id, row] of Object.entries(ROWS) as [RowId, Row][]) {
    const len = BAY_W * row.bays;
    // a box in row-local terms: centre (u, y, w), size along / up / across
    const box = (u: number, y: number, w: number, su: number, sy: number, sw: number, c?: string): Box => {
      const [x, z] = rowXZ(row, u, w);
      const ax = Math.abs(row.along[0]);
      return { p: [x, y, z], s: [ax * su + (1 - ax) * sw, sy, (1 - ax) * su + ax * sw], c };
    };

    for (let i = 0; i <= row.bays; i++) {
      for (const w of [-RACK_DEPTH / 2, RACK_DEPTH / 2]) uprights.push(box(i * BAY_W, RACK_H / 2, w, 0.06, RACK_H, 0.06));
    }
    LEVELS.forEach((y, level) => {
      for (const w of [-RACK_DEPTH / 2, RACK_DEPTH / 2]) beams.push(box(len / 2, y - 0.04, w, len, 0.07, 0.05));
      decks.push(box(len / 2, y - 0.015, 0, len, 0.025, RACK_DEPTH));

      for (let bay = 0; bay < row.bays; bay++) {
        const at = (s: Slot) => s.row === id && s.bay === bay && s.level === level;
        if (reserved.some(at)) continue;
        const low = at(SLOT_LOW);
        for (const du of low ? [-0.28] : [-0.28, 0.28]) {
          const r = seeded(n++);
          if (!low && r < 0.16) continue;
          const h = low ? 0.18 : 0.3 + seeded(n++) * 0.22;
          const wd = 0.44 + seeded(n++) * 0.06;
          const c = low ? '#f59e0b' : CRATE_COLORS[Math.floor(seeded(n++) * CRATE_COLORS.length)];
          const b = box(BAY_W * (bay + 0.5) + du, y + h / 2, 0, wd, h, 0.5, c);
          const [prefix, part] = low ? PARTS[1] : PARTS[Math.floor(seeded(n++) * PARTS.length)];
          const info: StockInfo = {
            id: crates.length,
            sku: low ? 'FLT-0187' : `${prefix}-${String(Math.floor(seeded(n++) * 9000) + 100).padStart(4, '0')}`,
            part,
            loc: slotLabel(id, bay, level),
            qty: low ? 4 : 6 + Math.floor(seeded(n++) * 130),
            low,
            top: [b.p[0], y + h + 0.45, b.p[2]],
            center: b.p,
            size: b.s,
          };
          crates.push({ ...b, info });
        }
      }
    });
  }
  return { uprights, beams, decks, crates };
}

function BoxSet({ items, color, metalness = 0.2, roughness = 0.7, emissive, opacity }: {
  items: Box[];
  color?: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  opacity?: number;
}) {
  return (
    <Instances limit={items.length} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial
        color={color}
        metalness={metalness}
        roughness={roughness}
        emissive={emissive}
        emissiveIntensity={emissive ? 0.6 : 0}
        transparent={opacity !== undefined}
        opacity={opacity ?? 1}
      />
      {items.map((b, i) => (
        <Instance key={i} position={b.p} scale={b.s} color={b.c} />
      ))}
    </Instances>
  );
}

/** Stocked boxes. Static after mount: hover is drawn by <Highlight>, so
 *  crossing boxes never re-renders the instances. */
function StockCrates({
  items,
  onHover,
  onPick,
}: {
  items: Crate[];
  onHover: (info: StockInfo | null) => void;
  onPick: (info: StockInfo) => void;
}) {
  return (
    <Instances limit={items.length} castShadow receiveShadow>
      <boxGeometry />
      <meshStandardMaterial roughness={0.85} metalness={0} />
      {items.map(({ p, s, c, info }) => (
        <Instance
          key={info.id}
          position={p}
          scale={s}
          color={c}
          onPointerOver={(e: ThreeEvent<PointerEvent>) => {
            e.stopPropagation();
            onHover(info);
          }}
          onPointerOut={() => onHover(null)}
          onClick={(e: ThreeEvent<MouseEvent>) => {
            // a drag that ends on a box orbits; it doesn't pick
            if (e.delta > 4) return;
            e.stopPropagation();
            onPick(info);
          }}
        />
      ))}
    </Instances>
  );
}

/** Glowing shell that glides to the hovered/pinned box and fades in and out. */
function Highlight({ activeRef }: { activeRef: RefObject<StockInfo | null> }) {
  const group = useRef<Group>(null);
  const fill = useRef<MeshBasicMaterial>(null);
  const line = useRef<LineBasicMaterial>(null);
  const shown = useRef(0);
  const goal = useMemo(() => ({ p: new Vector3(), s: new Vector3() }), []);
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry()), []);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g || !fill.current || !line.current) return;
    const dt = Math.min(delta, 0.1);
    const a = activeRef.current;
    if (a) {
      goal.p.set(a.center[0], a.center[1] + 0.05, a.center[2]);
      goal.s.set(a.size[0] * 1.12, a.size[1] * 1.12, a.size[2] * 1.12);
      if (shown.current < 0.02) {
        // appearing from nothing: start on the box, slightly small, and pop
        g.position.copy(goal.p);
        g.scale.copy(goal.s).multiplyScalar(0.85);
      }
      const k = 1 - Math.exp(-dt * 16);
      g.position.lerp(goal.p, k);
      g.scale.lerp(goal.s, k);
    }
    shown.current += ((a ? 1 : 0) - shown.current) * (1 - Math.exp(-dt * 12));
    g.visible = shown.current > 0.01;
    fill.current.opacity = shown.current * 0.3;
    line.current.opacity = shown.current;
  });

  return (
    <group ref={group} visible={false}>
      <mesh>
        <boxGeometry />
        <meshBasicMaterial ref={fill} color="#60a5fa" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial ref={line} color="#dbeafe" transparent opacity={0} toneMapped={false} />
      </lineSegments>
    </group>
  );
}

function Lanes() {
  const refs = useRef<(Line2 | null)[]>([]);
  const lanes = useMemo(() => LANES.map((c) => c.getPoints(80).map((p) => [p.x, 0.012, p.z] as [number, number, number])), []);
  useFrame((_, dt) => {
    for (const l of refs.current) if (l) l.material.dashOffset -= Math.min(dt, 0.1) * 0.6;
  });
  return (
    <>
      {lanes.map((pts, i) => (
        <Line
          key={i}
          ref={(l) => {
            refs.current[i] = l as Line2 | null;
          }}
          points={pts}
          color="#38bdf8"
          lineWidth={1.4}
          dashed
          dashSize={0.18}
          gapSize={0.14}
          transparent
          opacity={0.55}
        />
      ))}
    </>
  );
}

function Dock() {
  const { x, z } = DOCK_LAND;
  const rollers = useMemo(() => Array.from({ length: 9 }, (_, i) => 1.95 + i * 0.16), []);
  return (
    <group>
      {/* conveyor bed from the AGV bay out under the scan arch */}
      <mesh position={[x, DECK_REST / 2 - 0.02, (1.88 + 3.3) / 2]} castShadow receiveShadow>
        <boxGeometry args={[0.72, DECK_REST - 0.04, 3.3 - 1.88]} />
        <meshStandardMaterial color="#111a2e" metalness={0.5} roughness={0.5} />
      </mesh>
      {rollers.map((rz) => (
        <mesh key={rz} position={[x, DECK_REST - 0.025, rz]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.035, 0.035, 0.66, 10]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      {/* scan arch */}
      {[-0.5, 0.5].map((dx) => (
        <mesh key={dx} position={[x + dx, 0.68, z]} castShadow>
          <boxGeometry args={[0.07, 1.36, 0.12]} />
          <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      <mesh position={[x, 1.36, z]} castShadow>
        <boxGeometry args={[1.07, 0.09, 0.16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[x, 1.3, z + 0.081]}>
        <boxGeometry args={[0.8, 0.025, 0.005]} />
        <meshBasicMaterial color="#60a5fa" toneMapped={false} />
      </mesh>
    </group>
  );
}

function Warehouse({
  activeRef,
  onHover,
  onPick,
}: {
  activeRef: RefObject<StockInfo | null>;
  onHover: (info: StockInfo | null) => void;
  onPick: (info: StockInfo) => void;
}) {
  const { uprights, beams, decks, crates } = useMemo(() => rackParts(), []);
  const edge = useMemo(() => {
    const hw = PLATFORM.w / 2 - 0.08;
    const hd = PLATFORM.d / 2 - 0.08;
    return [
      [-hw, 0.006, -hd],
      [hw, 0.006, -hd],
      [hw, 0.006, hd],
      [-hw, 0.006, hd],
      [-hw, 0.006, -hd],
    ] as [number, number, number][];
  }, []);

  return (
    <group>
      <RoundedBox args={[PLATFORM.w, 0.32, PLATFORM.d]} radius={0.12} smoothness={3} position={[0, -0.16, 0]} receiveShadow>
        <meshStandardMaterial color="#0b1324" metalness={0.3} roughness={0.75} />
      </RoundedBox>
      <Grid
        position={[0, 0.003, 0]}
        args={[PLATFORM.w - 0.2, PLATFORM.d - 0.2]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#1b2b4a"
        sectionSize={2}
        sectionThickness={1}
        sectionColor="#1e40af"
        fadeDistance={40}
        fadeStrength={0}
      />
      <Line points={edge} color="#3b82f6" lineWidth={1.6} transparent opacity={0.8} />
      <Lanes />

      <BoxSet items={uprights} color="#2c4a86" metalness={0.7} roughness={0.35} />
      <BoxSet items={beams} color="#3b82f6" metalness={0.5} roughness={0.4} emissive="#1d4ed8" />
      <BoxSet items={decks} color="#1e293b" metalness={0.4} roughness={0.6} opacity={0.85} />
      <StockCrates items={crates} onHover={onHover} onPick={onPick} />
      <Highlight activeRef={activeRef} />

      <Dock />
    </group>
  );
}

export default memo(Warehouse);
