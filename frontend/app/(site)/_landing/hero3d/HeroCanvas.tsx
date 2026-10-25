'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, Sparkles } from '@react-three/drei';
import { useInView, useReducedMotion } from 'framer-motion';
import { Vector3 } from 'three';
import { useLanguage } from '@/app/context/LanguageContext';
import { useMotionPause } from '../primitives';
import Warehouse, { type PartKey, type StockInfo } from './Warehouse';
import Story from './Story';
import Cards, { type Anchors, type SceneLabels } from './Cards';
import { STATIC_T, phaseAt, type Phase } from './timeline';

/* ─── WebGL hero ─────────────────────────────────────────────────────
   A miniature warehouse running the Receive → Move → Track story (see
   timeline.ts). Loaded with ssr:false from the landing page; low-end or
   WebGL-less devices get the CSS HeroScene instead. Drag orbits the
   camera, hovering a stocked box shows its card (click pins it), and the
   robot hops when clicked. Scrolling flies the camera up over the racks.
   The render loop stops while paused or offscreen; with reduced motion
   one finished frame is drawn on demand. Mouse-only extras, so the whole
   thing stays aria-hidden. */

const LOOK_AT = new Vector3(-0.4, 0.7, -0.3);
const AZ_RANGE: [number, number] = [-1.0, 1.0];
const EL_RANGE: [number, number] = [-0.3, 0.45];
/** Seconds without input before a dragged camera eases home. */
const IDLE_RETURN = 3.5;

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

/** Drag to orbit (with inertia, easing back when left alone), lean toward
 *  the pointer, rise over the racks on scroll; backs off on narrow
 *  canvases so the diorama always fits. */
function CameraRig({ still, onDrag }: { still: boolean; onDrag: (dragging: boolean) => void }) {
  const pointer = useRef({ x: 0, y: 0 });
  const orbit = useRef({ az: 0, el: 0, vAz: 0, vEl: 0, dragging: false, x: 0, y: 0, idle: 0 });
  const camera = useThree((s) => s.camera);
  const canvas = useThree((s) => s.gl.domElement);
  const aspect = useThree((s) => s.size.width / s.size.height);
  const goal = useRef(new Vector3());
  const look = useRef(new Vector3());
  const placed = useRef(false);

  useEffect(() => {
    if (still || !window.matchMedia('(pointer: fine)').matches) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = e.clientX / window.innerWidth - 0.5;
      pointer.current.y = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [still]);

  useEffect(() => {
    if (still) return;
    const o = orbit.current;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      Object.assign(o, { dragging: true, x: e.clientX, y: e.clientY, vAz: 0, vEl: 0, idle: 0 });
      canvas.setPointerCapture(e.pointerId);
      onDrag(true);
    };
    const move = (e: PointerEvent) => {
      if (!o.dragging) return;
      o.vAz = -(e.clientX - o.x) * 0.006;
      o.vEl = (e.clientY - o.y) * 0.004;
      o.az = clamp(o.az + o.vAz, AZ_RANGE);
      o.el = clamp(o.el + o.vEl, EL_RANGE);
      o.x = e.clientX;
      o.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      if (!o.dragging) return;
      o.dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      onDrag(false);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [still, canvas, onDrag]);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    const o = orbit.current;
    if (!o.dragging) {
      // fling inertia, then drift home once left alone
      o.az = clamp(o.az + o.vAz, AZ_RANGE);
      o.el = clamp(o.el + o.vEl, EL_RANGE);
      const decay = Math.exp(-dt * 7);
      o.vAz *= decay;
      o.vEl *= decay;
      o.idle += dt;
      if (o.idle > IDLE_RETURN) {
        const home = Math.exp(-dt * 1.4);
        o.az *= home;
        o.el *= home;
      }
    }
    const scroll = still ? 0 : Math.min(1, window.scrollY / (window.innerHeight * 0.9));
    const sway = still ? 0 : Math.sin(state.clock.elapsedTime * 0.15) * 0.07;
    const az = 0.68 + o.az + pointer.current.x * 0.25 + sway - scroll * 0.4;
    const el = 0.5 + o.el - pointer.current.y * 0.1 + scroll * 0.42;
    const r = 19.5 * Math.max(1, 1.5 / aspect) * (1 - scroll * 0.14);
    look.current.copy(LOOK_AT).setY(LOOK_AT.y - scroll * 0.5);
    goal.current
      .set(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r)
      .add(look.current);
    if (!placed.current || still) {
      camera.position.copy(goal.current);
      placed.current = true;
    } else {
      camera.position.lerp(goal.current, 1 - Math.exp(-dt * (o.dragging ? 10 : 2.5)));
    }
    camera.lookAt(look.current);
  });
  return null;
}

type SceneProps = {
  still: boolean;
  phase: Phase;
  onPhase: (p: Phase) => void;
  anchors: RefObject<Anchors>;
  barRef: RefObject<HTMLSpanElement | null>;
  activeRef: RefObject<StockInfo | null>;
  onHover: (info: StockInfo | null) => void;
  onPick: (info: StockInfo) => void;
  onPointable: (on: boolean) => void;
  onDrag: (dragging: boolean) => void;
};

/** Everything inside the canvas. Memoised with stable props so hover,
 *  cursor and drag state in HeroCanvas never re-render the 3D tree. */
const Scene = memo(function Scene({ still, phase, onPhase, anchors, barRef, activeRef, onHover, onPick, onPointable, onDrag }: SceneProps) {
  return (
    <>
      <CameraRig still={still} onDrag={onDrag} />

      <hemisphereLight args={['#9cc2ff', '#0b1020', 0.55]} />
      <directionalLight
        position={[6, 10, 5]}
        intensity={1.6}
        color="#e8f0ff"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
        shadow-bias={-0.0005}
      />
      <pointLight position={[-5, 3, -4]} intensity={18} distance={14} color="#3b82f6" />
      <pointLight position={[5, 2.5, 4]} intensity={8} distance={10} color="#22d3ee" />

      {/* procedural studio reflections — no HDR download */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} color="#dbeafe" />
        <Lightformer form="rect" intensity={3} position={[-6, 2, -3]} rotation-y={Math.PI / 2} scale={[8, 2, 1]} color="#3b82f6" />
        <Lightformer form="ring" intensity={2} position={[6, 3, 4]} scale={3} color="#22d3ee" />
      </Environment>

      <Warehouse activeRef={activeRef} onHover={onHover} onPick={onPick} />
      <Story still={still} phase={phase} onPhase={onPhase} anchors={anchors} barRef={barRef} activeRef={activeRef} onPointable={onPointable} />
      {!still && <Sparkles count={70} scale={[11, 4, 7]} position={[0, 2, 0]} size={2.2} speed={0.25} opacity={0.6} color="#93c5fd" />}
    </>
  );
});

const LABEL_KEYS = [
  'receive',
  'move',
  'track',
  'liveActivity',
  'lowStock',
  'left',
  'badgeReceive',
  'badgeMove',
  'badgeAdjust',
  'badgeShip',
  'location',
  'qty',
  'dragHint',
] as const;
const PART_KEYS: PartKey[] = ['brakePads', 'oilFilter', 'timingBelt', 'sparkPlug', 'wheelBearing', 'clutchKit'];

function HeroCanvas() {
  const { t } = useLanguage();
  const reduce = useReducedMotion() ?? false;
  const { paused } = useMotionPause();
  const wrap = useRef<HTMLDivElement>(null);
  const inView = useInView(wrap, { margin: '120px 0px 120px 0px' });
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>(() => phaseAt(reduce ? STATIC_T : 0));
  const anchors = useRef<Anchors>({});
  const bar = useRef<HTMLSpanElement>(null);

  const [hover, setHover] = useState<StockInfo | null>(null);
  const [pinned, setPinned] = useState<StockInfo | null>(null);
  const [robotHover, setRobotHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [touched, setTouched] = useState(false);
  const [finePointer] = useState(() => window.matchMedia('(pointer: fine)').matches);
  const inspect = hover ?? pinned;
  // the 3D side reads the active box from here each frame instead of props
  const activeRef = useRef<StockInfo | null>(null);
  useEffect(() => {
    activeRef.current = inspect;
  }, [inspect]);

  const onDrag = useCallback((d: boolean) => {
    setDragging(d);
    setTouched(true);
  }, []);
  const onHover = useCallback((info: StockInfo | null) => {
    setHover(info);
    if (info) setTouched(true);
  }, []);
  const onPick = useCallback((info: StockInfo) => setPinned((p) => (p?.id === info.id ? null : info)), []);

  const labels = useMemo(
    () =>
      ({
        ...Object.fromEntries(LABEL_KEYS.map((k) => [k, t(`landing.scene.${k}`)])),
        parts: Object.fromEntries(PART_KEYS.map((k) => [k, t(`landing.scene.items.${k}`)])),
      }) as SceneLabels,
    [t],
  );

  const frameloop = reduce ? 'demand' : paused || !inView ? 'never' : 'always';

  return (
    <div
      ref={wrap}
      aria-hidden="true"
      className="absolute inset-0 transition-opacity duration-1000"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <Canvas
        frameloop={frameloop}
        shadows
        dpr={[1, 1.75]}
        // size only; tracking page offset on scroll re-applies the size and
        // reallocates the drawing buffer on every scroll step
        resize={{ scroll: false }}
        camera={{ fov: 30, near: 0.5, far: 80, position: [10, 8, 11] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{
          pointerEvents: reduce ? 'none' : 'auto',
          // vertical swipes still scroll the page on touch
          touchAction: 'pan-y',
          cursor: dragging ? 'grabbing' : hover || robotHover ? 'pointer' : 'grab',
        }}
        onCreated={() => setReady(true)}
        onPointerMissed={() => setPinned(null)}
      >
        <Scene
          still={reduce}
          phase={phase}
          onPhase={setPhase}
          anchors={anchors}
          barRef={bar}
          activeRef={activeRef}
          onHover={onHover}
          onPick={onPick}
          onPointable={setRobotHover}
          onDrag={onDrag}
        />
      </Canvas>
      <Cards
        phase={phase}
        labels={labels}
        anchors={anchors}
        barRef={bar}
        inspect={inspect}
        pinned={!!pinned && inspect === pinned}
        hint={finePointer && !reduce && !touched}
      />
    </div>
  );
}

export default memo(HeroCanvas);
