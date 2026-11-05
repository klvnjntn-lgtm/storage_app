'use client';

import { memo, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Instance, Instances, RoundedBox } from '@react-three/drei';
import type { Group, MeshBasicMaterial } from 'three';
import { heroBus, SOLUTIONS, type SolutionKey } from '../solutions';
import { COUNTER, LIFT, ROAD, TRUCK_LEN, CARGO_FLOOR } from './timeline';

/* ─── The rest of the business, around the warehouse ─────────────────
   Tinted floor bays, the sales counter, the workshop's lift and the
   delivery road. Low-poly and mostly static: the only things that move
   are the car, the truck and the bay tints, all driven from Story through
   refs, so none of this re-renders after mount. */

type Rect = { x: [number, number]; z: [number, number] };
const BAYS: Record<SolutionKey, Rect> = {
  warehouse: { x: [-5.1, 3.25], z: [-3.3, -1.05] },
  sales: { x: [-2.3, 0.3], z: [-0.02, 1.62] },
  workshop: { x: [-3.6, 0.2], z: [2.1, 5.05] },
  delivery: { x: [ROAD.x - ROAD.w / 2 - 0.1, ROAD.x + ROAD.w / 2 + 0.1], z: [ROAD.z0, ROAD.z1] },
};

/** The story's current zone; Story writes it, the bays read it per frame. */
export const activeZone: { current: SolutionKey | null } = { current: null };

function Bay({ zone, hex }: { zone: SolutionKey; hex: string }) {
  const fill = useRef<MeshBasicMaterial>(null);
  const lit = useRef(0);
  const { x, z } = BAYS[zone];
  useFrame((_, delta) => {
    if (!fill.current) return;
    const on = (heroBus.focus ?? activeZone.current) === zone ? 1 : 0;
    lit.current += (on - lit.current) * (1 - Math.exp(-Math.min(delta, 0.1) * 5));
    fill.current.opacity = 0.06 + lit.current * 0.17;
  });
  return (
    <mesh position={[(x[0] + x[1]) / 2, 0.009, (z[0] + z[1]) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[x[1] - x[0], z[1] - z[0]]} />
      <meshBasicMaterial ref={fill} color={hex} transparent opacity={0.06} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

function SalesCounter({ screen }: { screen: RefObject<MeshBasicMaterial | null> }) {
  const { x, z } = COUNTER;
  return (
    <group position={[x, 0, z]}>
      <RoundedBox args={[2.0, 0.78, 0.72]} radius={0.05} smoothness={2} position={[0, 0.39, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#e2e8f0" metalness={0.15} roughness={0.5} />
      </RoundedBox>
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[2.06, 0.04, 0.78]} />
        <meshStandardMaterial color="#047857" metalness={0.2} roughness={0.45} />
      </mesh>
      {/* POS terminal */}
      <mesh position={[-0.42, 0.9, -0.1]}>
        <boxGeometry args={[0.1, 0.16, 0.1]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[-0.42, 1.14, 0]} rotation={[-0.18, 0, 0]} castShadow>
        <boxGeometry args={[0.72, 0.46, 0.04]} />
        <meshStandardMaterial color="#0f172a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[-0.42, 1.14, 0.024]} rotation={[-0.18, 0, 0]}>
        <planeGeometry args={[0.65, 0.39]} />
        <meshBasicMaterial ref={screen} color="#34d399" toneMapped={false} />
      </mesh>
      {/* receipt printer */}
      <RoundedBox args={[0.34, 0.16, 0.36]} radius={0.03} smoothness={2} position={[0.45, 0.9, 0]} castShadow>
        <meshStandardMaterial color="#334155" metalness={0.4} roughness={0.5} />
      </RoundedBox>
      {/* filed documents */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0.82, 0.83 + i * 0.018, 0.04 * (i % 2)]} rotation={[0, 0.1 * i, 0]}>
          <boxGeometry args={[0.24, 0.012, 0.32]} />
          <meshStandardMaterial color="#f8fafc" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Wheel({ position }: { position: [number, number, number] }) {
  return (
    <mesh position={position} rotation={[Math.PI / 2, 0, 0]} castShadow>
      <cylinderGeometry args={[0.2, 0.2, 0.15, 14]} />
      <meshStandardMaterial color="#0b1020" roughness={0.9} />
    </mesh>
  );
}

function Workshop({ car }: { car: RefObject<Group | null> }) {
  const posts: [number, number][] = [
    [LIFT.x, LIFT.z - 0.86],
    [LIFT.x, LIFT.z + 0.86],
  ];
  return (
    <group>
      {posts.map(([x, z]) => (
        <mesh key={z} position={[x, 0.9, z]} castShadow>
          <boxGeometry args={[0.14, 1.8, 0.14]} />
          <meshStandardMaterial color="#d97706" metalness={0.4} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[LIFT.x, 1.84, LIFT.z]} castShadow>
        <boxGeometry args={[0.12, 0.1, 1.86]} />
        <meshStandardMaterial color="#d97706" metalness={0.4} roughness={0.45} />
      </mesh>

      {/* the car rides the lift; its arms ride with it */}
      <group ref={car} position={[LIFT.x, 0, LIFT.z]}>
        <mesh position={[0, 0.17, 0]}>
          <boxGeometry args={[0.16, 0.04, 1.72]} />
          <meshStandardMaterial color="#92400e" metalness={0.5} roughness={0.5} />
        </mesh>
        <RoundedBox args={[2.2, 0.34, 0.96]} radius={0.1} smoothness={2} position={[0, 0.39, 0]} castShadow>
          <meshStandardMaterial color="#e11d48" metalness={0.55} roughness={0.28} />
        </RoundedBox>
        <RoundedBox args={[1.1, 0.3, 0.84]} radius={0.1} smoothness={2} position={[-0.08, 0.68, 0]} castShadow>
          <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.15} />
        </RoundedBox>
        {[-0.72, 0.72].flatMap((x) => [-0.46, 0.46].map((z) => <Wheel key={`${x}${z}`} position={[x, 0.2, z]} />))}
      </group>

      {/* toolbox */}
      <group position={[-3.05, 0, 4.42]}>
        <RoundedBox args={[0.8, 0.66, 0.42]} radius={0.03} smoothness={2} position={[0, 0.33, 0]} castShadow>
          <meshStandardMaterial color="#b91c1c" metalness={0.4} roughness={0.4} />
        </RoundedBox>
        {[0.16, 0.34, 0.52].map((y) => (
          <mesh key={y} position={[0, y, 0.212]}>
            <boxGeometry args={[0.7, 0.012, 0.005]} />
            <meshBasicMaterial color="#fecaca" toneMapped={false} />
          </mesh>
        ))}
        {/* wrench on the lid */}
        <mesh position={[0, 0.675, 0]} rotation={[0, 0.5, 0]}>
          <boxGeometry args={[0.46, 0.03, 0.06]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.9} roughness={0.2} />
        </mesh>
      </group>

      {/* spare tyres */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[-0.3, 0.11 + i * 0.2, 4.6]} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.18, 16]} />
          <meshStandardMaterial color="#111827" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

function Road() {
  const dashes = useMemo(() => {
    const out: number[] = [];
    for (let z = ROAD.z0 + 0.4; z < ROAD.z1 - 0.2; z += 0.75) out.push(z);
    return out;
  }, []);
  const len = ROAD.z1 - ROAD.z0;
  return (
    <group>
      <mesh position={[ROAD.x, 0.006, (ROAD.z0 + ROAD.z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ROAD.w, len]} />
        <meshStandardMaterial color="#141b2e" roughness={0.9} />
      </mesh>
      <Instances limit={dashes.length}>
        <planeGeometry args={[0.05, 0.34]} />
        <meshBasicMaterial color="#c4b5fd" toneMapped={false} transparent opacity={0.65} />
        {dashes.map((z) => (
          <Instance key={z} position={[ROAD.x, 0.012, z]} rotation={[-Math.PI / 2, 0, 0]} />
        ))}
      </Instances>
      {/* delivery stops along the route */}
      {[-2.2, 0.2, 2.6].map((z) => (
        <group key={z} position={[ROAD.x + ROAD.w / 2 + 0.3, 0, z]}>
          <mesh position={[0, 0.2, 0]} rotation={[Math.PI, 0, 0]}>
            <coneGeometry args={[0.1, 0.3, 10]} />
            <meshBasicMaterial color="#a78bfa" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.38, 0]}>
            <sphereGeometry args={[0.1, 10, 8]} />
            <meshBasicMaterial color="#c4b5fd" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Truck({ truck }: { truck: RefObject<Group | null> }) {
  const half = TRUCK_LEN / 2;
  const cargoLen = TRUCK_LEN - 0.86;
  const cargoZ = half - cargoLen / 2;
  return (
    <group ref={truck} position={[ROAD.x, 0, 0]} visible={false}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[1.04, 0.14, TRUCK_LEN]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* cargo box; the tail is a dark opening the crate disappears into */}
      <mesh position={[0, CARGO_FLOOR + 0.6, cargoZ]} castShadow>
        <boxGeometry args={[1.16, 1.24, cargoLen]} />
        <meshStandardMaterial color="#f1f5f9" metalness={0.1} roughness={0.55} />
      </mesh>
      <mesh position={[0, CARGO_FLOOR + 0.6, half + 0.002]}>
        <planeGeometry args={[1.02, 1.1]} />
        <meshBasicMaterial color="#0b1020" />
      </mesh>
      {[-0.586, 0.586].map((x) => (
        <mesh key={x} position={[x, CARGO_FLOOR + 0.34, cargoZ]}>
          <boxGeometry args={[0.006, 0.16, cargoLen]} />
          <meshBasicMaterial color="#8b5cf6" toneMapped={false} />
        </mesh>
      ))}
      {/* cab */}
      <RoundedBox args={[1.12, 0.92, 0.78]} radius={0.08} smoothness={2} position={[0, 0.79, -half + 0.39]} castShadow>
        <meshStandardMaterial color="#7c3aed" metalness={0.3} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0.98, -half - 0.015]}>
        <boxGeometry args={[0.94, 0.36, 0.02]} />
        <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.1} />
      </mesh>
      {[-0.52, 0.52].flatMap((x) =>
        [-half + 0.45, half - 0.45].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.2, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.15, 14]} />
            <meshStandardMaterial color="#0b1020" roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}

export type ZoneRefs = {
  car: RefObject<Group | null>;
  truck: RefObject<Group | null>;
  screen: RefObject<MeshBasicMaterial | null>;
};

function Zones({ car, truck, screen }: ZoneRefs) {
  return (
    <group>
      {SOLUTIONS.map((s) => (
        <Bay key={s.key} zone={s.key} hex={s.hex} />
      ))}
      <SalesCounter screen={screen} />
      <Workshop car={car} />
      <Road />
      <Truck truck={truck} />
    </group>
  );
}

export default memo(Zones);
