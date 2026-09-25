'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring } from 'framer-motion';
import {
  LayoutDashboard,
  Boxes,
  PackagePlus,
  ArrowLeftRight,
  Truck,
  History,
  CheckCircle2,
  Package,
  TriangleAlert,
  Warehouse,
} from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useAnimState, useMotionPause } from './primitives';
import styles from './HeroScene.module.css';

/* ─── Hero centrepiece ─────────────────────────────────────────────
   A live WareSys window, tilted in 3D, with three event cards floating
   in front of it at different depths. One 16s loop tells the product
   story — the same Receive → Move → Track as "How it works":
     receive  a scan lands, the stock row lights up and its qty rolls up
     move     a transfer runs A-03 → B-11 and the row's location updates
     track    the activity feed logs both, a low-stock alert fires
   Light pulses travel down the tethers into the exact cell they change.
   All motion is CSS keyframes on transform/opacity; with reduced motion
   the scene renders its final, fully-populated state. Decorative only
   (aria-hidden). Rig coordinates are px in a 900×720 stage. ───────── */

type Vec3 = [number, number, number];

/** A tether from a point on the window (z=0) out to a floating card:
 *  length plus the yaw/pitch that aim a flat line at it in 3D. */
function tether([ax, ay]: [number, number], [bx, by, bz]: Vec3) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy, bz);
  const yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
  const pitch = (Math.asin(bz / len) * 180) / Math.PI;
  // Rounded so server and client agree on the inline style strings.
  const r = (n: number) => Math.round(n * 100) / 100;
  return { len: r(len), yaw: r(yaw), pitch: r(pitch) };
}

const TETHERS: { key: 'scan' | 'move' | 'alert'; from: [number, number]; to: Vec3 }[] = [
  // scanner card → BRK-2041 row (SKU cell)
  { key: 'scan', from: [311, 358], to: [214, 410, 150] },
  // transfer card → the row's location cell
  { key: 'move', from: [646, 358], to: [712, 238, 110] },
  // low-stock toast → Low stock KPI tile
  { key: 'alert', from: [376, 238], to: [330, 118, 95] },
];

function Roll({ from, to, className = '' }: { from: ReactNode; to: ReactNode; className: string }) {
  return (
    <span className={styles.rollBox}>
      <span className={`${styles.rollStrip} ${className}`}>
        <span>{from}</span>
        <span>{to}</span>
      </span>
    </span>
  );
}

function Barcode() {
  const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 2, 1];
  let x = 0;
  return (
    <svg width="132" height="44" viewBox="0 0 132 44" className={styles.barcode}>
      {bars.map((w, i) => {
        const bar = i % 2 === 0 ? <rect key={i} x={x} y="0" width={w * 1.8} height="44" rx="0.4" /> : null;
        x += w * 1.8 + 1.8;
        return bar;
      })}
    </svg>
  );
}

export default function HeroScene() {
  const { t } = useLanguage();
  const s = (key: string) => t(`landing.scene.${key}`);
  const reduce = useReducedMotion();
  const { paused } = useMotionPause();
  const stageRef = useRef<HTMLDivElement>(null);
  const anim = useAnimState(stageRef);

  // Pointer parallax: the whole rig leans a few degrees toward the cursor.
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const rotateX = useSpring(rx, { stiffness: 60, damping: 18, mass: 0.8 });
  const rotateY = useSpring(ry, { stiffness: 60, damping: 18, mass: 0.8 });
  useEffect(() => {
    if (reduce || paused || !window.matchMedia('(pointer: fine)').matches) {
      rx.set(0);
      ry.set(0);
      return;
    }
    const onMove = (e: PointerEvent) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      ry.set(nx * 7);
      rx.set(ny * -5);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduce, paused, rx, ry]);

  const sidebar = [
    { icon: LayoutDashboard, label: s('dashboard'), active: true },
    { icon: Boxes, label: s('stock') },
    { icon: PackagePlus, label: s('receiving') },
    { icon: ArrowLeftRight, label: s('transfers') },
    { icon: Truck, label: s('deliveries') },
    { icon: History, label: s('auditLog') },
  ];

  const rows = [
    { sku: 'BRK-2041', item: s('items.brakePads'), loc: null, qty: null },
    { sku: 'FLT-0187', item: s('items.oilFilter'), loc: 'B-04', qty: '4', low: true },
    { sku: 'BLT-3302', item: s('items.timingBelt'), loc: 'A-07', qty: '21' },
    { sku: 'SPK-1120', item: s('items.sparkPlug'), loc: 'C-02', qty: '132' },
    { sku: 'BRG-0876', item: s('items.wheelBearing'), loc: 'B-04', qty: '9', low: true },
    { sku: 'CLT-5510', item: s('items.clutchKit'), loc: 'D-01', qty: '15' },
  ];

  return (
    <div ref={stageRef} className={styles.stage} aria-hidden="true" data-anim={anim}>
      <motion.div className={styles.parallax} style={{ rotateX, rotateY }}>
        <div className={styles.float}>
          <div className={styles.rig}>
            <div className={styles.halo} />
            <div className={styles.shadow} />

            {/* ─── The app window ─────────────────────────────── */}
            <div className={styles.window}>
              <div className={styles.topbar}>
                <span className={styles.dots}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className={styles.title}>WareSys · {s('warehouse')}</span>
                <span className={styles.live}>
                  <i />
                  {s('live')}
                </span>
              </div>

              <div className={styles.body}>
                <aside className={styles.sidebar}>
                  <div className={styles.brand}>
                    <span className={styles.brandMark}>
                      <Warehouse size={11} strokeWidth={2.4} />
                    </span>
                    WareSys
                  </div>
                  <p className={styles.navLabel}>{s('warehouse')}</p>
                  {sidebar.map(({ icon: Icon, label, active }) => (
                    <div key={label} className={`${styles.navItem} ${active ? styles.navActive : ''}`}>
                      <Icon size={12} strokeWidth={2} />
                      <span>{label}</span>
                    </div>
                  ))}
                </aside>

                <div className={styles.main}>
                  <div className={styles.mainHead}>
                    <span className={styles.pageTitle}>{s('dashboard')}</span>
                    <span className={styles.chip}>{s('today')} · 09:14</span>
                  </div>

                  <div className={styles.kpis}>
                    <div className={`${styles.kpi} ${styles.kpiAlert}`}>
                      <p>{s('lowStock')}</p>
                      <strong className={styles.amber}>
                        <Roll from="12" to="13" className={styles.rollLow} />
                      </strong>
                      <span className={styles.alertRing} />
                    </div>
                    <div className={styles.kpi}>
                      <p>{s('unitsInStock')}</p>
                      <strong>
                        <Roll from="12,480" to="12,492" className={styles.rollUnits} />
                      </strong>
                    </div>
                    <div className={styles.kpi}>
                      <p>{s('transfersToday')}</p>
                      <strong>
                        <Roll from="38" to="39" className={styles.rollTransfers} />
                      </strong>
                    </div>
                  </div>

                  <div className={styles.table}>
                    <div className={`${styles.tr} ${styles.th}`}>
                      <span>{s('sku')}</span>
                      <span>{s('item')}</span>
                      <span>{s('location')}</span>
                      <span className={styles.num}>{s('qty')}</span>
                    </div>
                    {rows.map((r, i) => (
                      <div key={r.sku} className={styles.tr}>
                        {i === 0 && <span className={styles.rowGlow} />}
                        <span className={styles.sku}>{r.sku}</span>
                        <span className={styles.item}>{r.item}</span>
                        <span className={styles.loc}>
                          {i === 0 ? <Roll from="A-03" to="B-11" className={styles.rollLoc} /> : r.loc}
                        </span>
                        <span className={`${styles.num} ${styles.qty} ${r.low ? styles.amber : ''}`}>
                          {i === 0 ? <Roll from="36" to="48" className={styles.rollQty} /> : r.qty}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Tethers: window cell → floating card ──────────── */}
            {TETHERS.map(({ key, from, to }) => {
              const { len, yaw, pitch } = tether(from, to);
              return (
                <span
                  key={key}
                  className={`${styles.tether} ${styles[`tether_${key}`]}`}
                  style={
                    {
                      left: from[0],
                      top: from[1],
                      width: len,
                      '--yaw': `${yaw}deg`,
                      '--pitch': `${-pitch}deg`,
                      '--len': `${len}px`,
                    } as CSSProperties
                  }
                >
                  <i className={`${styles.pulse} ${styles[`pulse_${key}`]}`} />
                </span>
              );
            })}
            {TETHERS.map(({ key, from }) => (
              <span key={`dot-${key}`} className={`${styles.anchor} ${styles[`anchor_${key}`]}`} style={{ left: from[0], top: from[1] }} />
            ))}

            {/* ─── 01 Receive: scanner ───────────────────────────── */}
            <div className={`${styles.card} ${styles.cardScan}`} style={{ '--x': '0px', '--y': '330px', '--z': '150px' } as CSSProperties}>
              <div className={styles.cardHead}>
                <span className={styles.tag}>01 · {s('receive')}</span>
                <span className={styles.time}>09:13</span>
              </div>
              <div className={styles.viewfinder}>
                <div className={styles.label}>
                  <Barcode />
                  <span>BRK-2041</span>
                </div>
                <span className={styles.reticle} />
                <span className={styles.laser} />
                <span className={styles.flash} />
              </div>
              <div className={styles.scanResult}>
                <CheckCircle2 size={13} strokeWidth={2.2} className={styles.ok} />
                <span className={styles.sku}>BRK-2041</span>
                <span className={styles.plus}>+12</span>
                <span className={styles.muted}>→ A-03</span>
              </div>
            </div>

            {/* ─── 02 Move: transfer ─────────────────────────────── */}
            <div className={`${styles.card} ${styles.cardMove}`} style={{ '--x': '672px', '--y': '118px', '--z': '110px' } as CSSProperties}>
              <div className={styles.cardHead}>
                <span className={styles.tag}>02 · {s('move')}</span>
                <span className={styles.time}>09:14</span>
              </div>
              <div className={styles.route}>
                <span className={styles.rack}>
                  <i />
                  <i />
                  <i />
                  <b>A-03</b>
                </span>
                <svg className={styles.path} width="212" height="46" viewBox="0 0 212 46">
                  <path d="M 62 30 C 92 2, 120 2, 150 30" />
                </svg>
                <span className={styles.parcel}>
                  <Package size={11} strokeWidth={2.2} />
                </span>
                <span className={`${styles.rack} ${styles.rackTo}`}>
                  <i />
                  <i />
                  <i />
                  <b>B-11</b>
                </span>
              </div>
              <p className={styles.moveMeta}>
                12× <span className={styles.sku}>BRK-2041</span> · Rina
              </p>
            </div>

            {/* ─── 03 Track: activity feed ───────────────────────── */}
            <div className={`${styles.card} ${styles.cardFeed}`} style={{ '--x': '634px', '--y': '508px', '--z': '180px' } as CSSProperties}>
              <div className={styles.cardHead}>
                <span className={styles.tag}>03 · {s('track')}</span>
                <span className={styles.feedLive}>
                  <i />
                  {s('liveActivity')}
                </span>
              </div>
              <div className={styles.feedViewport}>
                <div className={styles.feedList}>
                  <div className={`${styles.feedRow} ${styles.feedNew2}`}>
                    <span className={`${styles.avatar} ${styles.avBlue}`}>R</span>
                    <span className={`${styles.badge} ${styles.bMove}`}>{s('badgeMove')}</span>
                    <span className={styles.feedText}>12× A-03 → B-11</span>
                    <span className={styles.time}>09:14</span>
                  </div>
                  <div className={`${styles.feedRow} ${styles.feedNew1}`}>
                    <span className={`${styles.avatar} ${styles.avGreen}`}>B</span>
                    <span className={`${styles.badge} ${styles.bReceive}`}>{s('badgeReceive')}</span>
                    <span className={styles.feedText}>+12 BRK-2041</span>
                    <span className={styles.time}>09:13</span>
                  </div>
                  <div className={styles.feedRow}>
                    <span className={`${styles.avatar} ${styles.avAmber}`}>S</span>
                    <span className={`${styles.badge} ${styles.bAdjust}`}>{s('badgeAdjust')}</span>
                    <span className={styles.feedText}>FLT-0187 9 → 4</span>
                    <span className={styles.time}>09:02</span>
                  </div>
                  <div className={styles.feedRow}>
                    <span className={`${styles.avatar} ${styles.avViolet}`}>D</span>
                    <span className={`${styles.badge} ${styles.bShip}`}>{s('badgeShip')}</span>
                    <span className={styles.feedText}>DO-2210 · R-12</span>
                    <span className={styles.time}>08:47</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── Low-stock alert ───────────────────────────────── */}
            <div className={`${styles.card} ${styles.toast}`} style={{ '--x': '222px', '--y': '80px', '--z': '95px' } as CSSProperties}>
              <span className={styles.toastIcon}>
                <TriangleAlert size={13} strokeWidth={2.2} />
              </span>
              <span className={styles.toastText}>
                <b>{s('lowStock')}</b>
                <span>
                  <span className={styles.sku}>FLT-0187</span> · {s('left')}
                </span>
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
