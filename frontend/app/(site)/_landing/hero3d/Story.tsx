'use client';

import { memo, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Line, RoundedBox } from '@react-three/drei';
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PointLight, Vector3 } from 'three';
import type { Line2 } from 'three-stdlib';
import {
  CRATE,
  DOCK_LAND,
  LOOP,
  SLOT_A03,
  SLOT_B11,
  SLOT_LOW,
  STATIC_T,
  T,
  agvPose,
  easeInOut,
  cratePose,
  flash,
  moveProgress,
  phaseAt,
  scanLaser,
  type AgvPose,
  type Phase,
} from './timeline';
import type { Anchors } from './Cards';
import type { StockInfo } from './Warehouse';

type V3 = [number, number, number];

// Where each card floats, and the point its beam lands on.
const CARDS = {
  receive: { at: [5.6, 1.5, 3.8] as V3, to: [DOCK_LAND.x + 0.5, 1.36, DOCK_LAND.z] as V3 },
  move: { at: [-1.4, 3.9, -2.8] as V3, to: [-1.4, 2.25, -2.6] as V3 },
  feed: { at: [-4.5, 3.5, 1.9] as V3, to: [-4.4, 2.25, 1.4] as V3 },
  alert: { at: [2.6, 3.5, -2.8] as V3, to: [SLOT_LOW.pos.x, SLOT_LOW.pos.y + 0.2, SLOT_LOW.pos.z] as V3 },
};

export type AnchorKey = keyof typeof CARDS | 'slotA03' | 'slotB11' | 'inspect';

const ANCHORS: Record<Exclude<AnchorKey, 'inspect'>, Vector3> = {
  ...(Object.fromEntries(Object.entries(CARDS).map(([k, c]) => [k, new Vector3(...c.at)])) as Record<keyof typeof CARDS, Vector3>),
  slotA03: SLOT_A03.pos.clone().addScaledVector(SLOT_A03.face, 0.36).setY(SLOT_A03.pos.y + 0.62),
  slotB11: SLOT_B11.pos.clone().addScaledVector(SLOT_B11.face, 0.36).setY(SLOT_B11.pos.y + 0.62),
};
/** Cards dropped when the canvas is too narrow to read them. */
const WIDE_ONLY: AnchorKey[] = ['feed', 'alert', 'slotA03', 'slotB11'];
const COMPACT_W = 600;
/** World units per CSS px of card, before clamping. */
const CARD_UNIT = 0.0135;

/** Pins each DOM anchor to its 3D point, scaled with perspective. */
function Projector({ anchors, activeRef }: { anchors: RefObject<Anchors>; activeRef: RefObject<StockInfo | null> }) {
  const v = useMemo(() => new Vector3(), []);
  const inspectRef = useRef({ at: new Vector3(), goal: new Vector3(), placed: false });
  // last value written per anchor, so unchanged styles aren't re-set every frame
  const writtenRef = useRef(new Map<string, string>());
  useFrame(({ camera, size }, delta) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const inspect = inspectRef.current;
    const written = writtenRef.current;
    const tanHalf = Math.tan((camera.fov * Math.PI) / 360);
    const compact = size.width < COMPACT_W;
    const points = Object.entries(ANCHORS) as [AnchorKey, Vector3][];
    const active = activeRef.current;
    if (active) {
      // the stock card glides between boxes instead of jumping
      inspect.goal.set(...active.top);
      if (!inspect.placed) inspect.at.copy(inspect.goal);
      else inspect.at.lerp(inspect.goal, 1 - Math.exp(-Math.min(delta, 0.1) * 16));
      inspect.placed = true;
      points.push(['inspect', inspect.at]);
    } else {
      inspect.placed = false;
    }
    const put = (el: HTMLDivElement, key: string, prop: string, value: string) => {
      const k = key + prop;
      if (written.get(k) === value) return;
      written.set(k, value);
      el.style.setProperty(prop, value);
    };
    for (const [key, p] of points) {
      const el = anchors.current[key];
      if (!el) {
        written.delete(key + 'visibility');
        written.delete(key + 'transform');
        continue;
      }
      v.copy(p).project(camera);
      const hidden = v.z > 1 || (compact && WIDE_ONLY.includes(key));
      put(el, key, 'visibility', hidden ? 'hidden' : 'visible');
      if (hidden) continue;
      const pxPerUnit = size.height / (2 * camera.position.distanceTo(p) * tanHalf);
      const scale = Math.min(1.05, Math.max(0.5, pxPerUnit * CARD_UNIT));
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      put(
        el,
        key,
        'transform',
        `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, ${key === 'inspect' ? '-100%' : '-50%'}) scale(${scale.toFixed(3)})`,
      );
    }
  });
  return null;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** Beam from a card down to what it's about; dashes flow toward the target. */
function Beam({ from, to, color, on, beamRef }: { from: V3; to: V3; color: string; on: boolean; beamRef: (l: Line2 | null) => void }) {
  // a fresh points array would rebuild the line geometry on every render
  const points = useMemo(() => [from, to], [from, to]);
  return (
    <Line
      ref={beamRef}
      points={points}
      color={color}
      lineWidth={1.3}
      dashed
      dashSize={0.12}
      gapSize={0.09}
      transparent
      opacity={on ? 0.9 : 0.22}
    />
  );
}

function Story({
  still,
  phase,
  onPhase,
  anchors,
  barRef,
  activeRef,
  onPointable,
}: {
  still: boolean;
  phase: Phase;
  onPhase: (p: Phase) => void;
  anchors: RefObject<Anchors>;
  barRef: RefObject<HTMLSpanElement | null>;
  activeRef: RefObject<StockInfo | null>;
  /** The pointer is over something clickable (for the cursor). */
  onPointable: (on: boolean) => void;
}) {
  const time = useRef(still ? STATIC_T : 0);
  const pose = useMemo<AgvPose>(() => ({ pos: new Vector3(), dir: new Vector3(1, 0, 0), deck: 0, moving: false }), []);
  const cratePos = useMemo(() => new Vector3(), []);
  const heading = useRef<number | null>(null);
  const glow = useMemo(() => glowTexture(), []);
  const phaseKey = useRef('');
  const compact = useThree((s) => s.size.width < COMPACT_W);
  /** Clock time of the last click on the robot; it hops and spins. */
  const hopAt = useRef(-Infinity);
  const clockRef = useRef(0);

  const agv = useRef<Group>(null);
  const deck = useRef<Mesh>(null);
  const mast = useRef<Mesh>(null);
  const crate = useRef<Group>(null);
  const laser = useRef<Mesh>(null);
  const scanLight = useRef<PointLight>(null);
  const beacon = useRef<MeshBasicMaterial>(null);
  const glowA = useRef<MeshBasicMaterial>(null);
  const glowB = useRef<MeshBasicMaterial>(null);
  const glowLow = useRef<MeshBasicMaterial>(null);
  const lowLight = useRef<PointLight>(null);
  const beams = useRef<(Line2 | null)[]>([]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    if (!still) time.current = (time.current + dt) % LOOP;
    const t = time.current;
    const clock = state.clock.elapsedTime;
    clockRef.current = clock;

    agvPose(t, pose);
    const target = Math.atan2(-pose.dir.z, pose.dir.x);
    if (heading.current === null || still) heading.current = target;
    else {
      // ease toward the path tangent along the shortest arc
      let d = target - heading.current;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      heading.current += d * Math.min(1, dt * 7);
    }
    const k = (clock - hopAt.current) / 0.9;
    const hopY = k < 1 ? Math.sin(k * Math.PI) * 0.5 : 0;
    const spin = k < 1 ? easeInOut(k) * Math.PI * 2 : 0;
    if (agv.current) {
      agv.current.position.copy(pose.pos);
      agv.current.position.y += hopY;
      agv.current.rotation.y = heading.current + spin;
    }
    if (deck.current) deck.current.position.y = pose.deck - 0.02;
    if (mast.current) {
      const h = pose.deck - 0.28;
      mast.current.scale.y = h;
      mast.current.position.y = 0.26 + h / 2;
    }
    if (beacon.current) {
      const blink = pose.moving || k < 1;
      beacon.current.color.setHSL(k < 1 ? 0.33 : 0.55, 0.9, blink ? 0.45 + 0.25 * Math.sin(clock * 12) : 0.35);
    }

    const s = cratePose(t, pose, cratePos);
    if (crate.current) {
      crate.current.position.copy(cratePos);
      // riding the robot: hop and spin with it
      const riding = Math.hypot(cratePos.x - pose.pos.x, cratePos.z - pose.pos.z) < 0.05;
      crate.current.position.y += riding ? hopY : 0;
      crate.current.rotation.y = riding ? heading.current + spin : 0;
      crate.current.scale.setScalar(Math.max(0.001, s));
      crate.current.visible = s > 0.01;
    }

    const ly = scanLaser(t);
    if (laser.current) {
      laser.current.visible = ly !== null;
      if (ly !== null) laser.current.position.y = ly;
    }
    if (scanLight.current) scanLight.current.intensity = flash(t, T.scanned) * 6;

    if (glowA.current) glowA.current.opacity = (t >= T.putaway && t < 9.4 ? 0.55 : 0) + flash(t, T.putaway) * 0.6;
    if (glowB.current) glowB.current.opacity = (t >= T.moved ? 0.55 : 0) + flash(t, T.moved) * 0.6;
    const pulse = t >= T.alert ? 0.5 + 0.5 * Math.sin(clock * 5) : 0;
    if (glowLow.current) glowLow.current.opacity = pulse * 0.8;
    if (lowLight.current) lowLight.current.intensity = pulse * 2.2;

    if (barRef.current) barRef.current.style.setProperty('--p', moveProgress(t).toFixed(3));
    for (const b of beams.current) if (b) b.material.dashOffset -= dt * 0.5;

    const next = phaseAt(t);
    const key = Object.values(next).join();
    if (key !== phaseKey.current) {
      phaseKey.current = key;
      onPhase(next);
    }
  });

  const glowPlane = (ref: RefObject<MeshBasicMaterial | null> | undefined, color: string, size: number, opacity = 0) => (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial ref={ref} map={glow} color={color} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  );

  return (
    <group>
      {/* ─── AGV ─────────────────────────────────────────── */}
      <group
        ref={agv}
        onClick={(e) => {
          if (still || e.delta > 4) return;
          e.stopPropagation();
          if (clockRef.current - hopAt.current > 0.9) hopAt.current = clockRef.current;
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          onPointable(true);
        }}
        onPointerOut={() => onPointable(false)}
      >
        <RoundedBox args={[0.9, 0.2, 0.62]} radius={0.06} smoothness={3} position={[0, 0.16, 0]} castShadow>
          <meshStandardMaterial color="#e2e8f0" metalness={0.3} roughness={0.35} />
        </RoundedBox>
        <mesh position={[0, 0.075, 0]}>
          <boxGeometry args={[0.92, 0.035, 0.64]} />
          <meshBasicMaterial color="#38bdf8" toneMapped={false} />
        </mesh>
        <mesh position={[0.452, 0.17, 0]}>
          <boxGeometry args={[0.01, 0.05, 0.4]} />
          <meshBasicMaterial color="#e0f2fe" toneMapped={false} />
        </mesh>
        <mesh position={[-0.33, 0.29, 0.22]}>
          <cylinderGeometry args={[0.035, 0.035, 0.06, 12]} />
          <meshBasicMaterial ref={beacon} color="#38bdf8" toneMapped={false} />
        </mesh>
        {[-0.3, 0.3].flatMap((x) =>
          [-0.29, 0.29].map((z) => (
            <mesh key={`${x}${z}`} position={[x, 0.07, z]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.07, 0.07, 0.06, 14]} />
              <meshStandardMaterial color="#0f172a" roughness={0.9} />
            </mesh>
          )),
        )}
        <mesh ref={mast} position={[0, 0.27, 0]}>
          <boxGeometry args={[0.16, 1, 0.16]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh ref={deck} position={[0, 0.32, 0]} castShadow>
          <boxGeometry args={[0.62, 0.04, 0.54]} />
          <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.4} />
        </mesh>
        <group position={[0, 0.012, 0]}>{glowPlane(undefined, '#38bdf8', 1.6, 0.35)}</group>
      </group>

      {/* ─── The crate that tells the story ───────────────── */}
      <group ref={crate}>
        <mesh castShadow>
          <boxGeometry args={[CRATE.w, CRATE.h, CRATE.d]} />
          <meshStandardMaterial color="#d4a26a" roughness={0.8} />
        </mesh>
        <mesh position={[0, CRATE.h / 2 + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.1, CRATE.d]} />
          <meshStandardMaterial color="#a16207" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.02, CRATE.d / 2 + 0.001]}>
          <planeGeometry args={[0.26, 0.15]} />
          <meshBasicMaterial color="#f8fafc" />
        </mesh>
      </group>

      {/* ─── Scanner ──────────────────────────────────────── */}
      <mesh ref={laser} position={[DOCK_LAND.x, 0.5, DOCK_LAND.z]} visible={false}>
        <boxGeometry args={[0.95, 0.012, 0.62]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <pointLight ref={scanLight} position={[DOCK_LAND.x, 1.0, DOCK_LAND.z + 0.3]} color="#22c55e" intensity={0} distance={3} />

      {/* ─── Slot highlights ──────────────────────────────── */}
      <group position={[SLOT_A03.pos.x, SLOT_A03.pos.y + 0.003, SLOT_A03.pos.z]}>{glowPlane(glowA, '#3b82f6', 1.4)}</group>
      <group position={[SLOT_B11.pos.x, SLOT_B11.pos.y + 0.003, SLOT_B11.pos.z]}>{glowPlane(glowB, '#22c55e', 1.4)}</group>
      <group position={[SLOT_LOW.pos.x, SLOT_LOW.pos.y + 0.003, SLOT_LOW.pos.z]}>{glowPlane(glowLow, '#f59e0b', 1.4)}</group>
      <pointLight
        ref={lowLight}
        position={SLOT_LOW.pos.clone().addScaledVector(SLOT_LOW.face, 0.5).setY(SLOT_LOW.pos.y + 0.4)}
        color="#f59e0b"
        intensity={0}
        distance={2.5}
      />

      {/* ─── Floating UI ──────────────────────────────────── */}
      {(
        [
          ['receive', '#60a5fa', true],
          ['move', '#60a5fa', phase.moving || phase.moved],
          ['feed', '#a78bfa', true],
          ['alert', '#f59e0b', phase.alert],
        ] as const
      )
        .filter(([k]) => !(compact && WIDE_ONLY.includes(k)))
        .map(([k, color, on], i) => (
          <Beam
            key={k}
            from={CARDS[k].at}
            to={CARDS[k].to}
            color={color}
            on={on}
            beamRef={(l) => {
              beams.current[i] = l;
            }}
          />
        ))}
      <Projector anchors={anchors} activeRef={activeRef} />
    </group>
  );
}

export default memo(Story);
