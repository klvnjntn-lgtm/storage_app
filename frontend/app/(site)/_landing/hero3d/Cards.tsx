'use client';

import { memo, type RefObject } from 'react';
import { CheckCircle2, Hand, Package, Pin, TriangleAlert } from 'lucide-react';
import { SLOT_A03, SLOT_B11, type Phase } from './timeline';
import type { AnchorKey } from './Story';
import type { PartKey, StockInfo } from './Warehouse';
import styles from './Hero3D.module.css';

/* ─── Floating UI over the canvas ────────────────────────────────────
   Plain DOM in the page's own React tree. Story's projector moves each
   anchor onto its 3D point every frame. */

export type SceneLabels = Record<
  | 'receive'
  | 'move'
  | 'track'
  | 'liveActivity'
  | 'lowStock'
  | 'left'
  | 'badgeReceive'
  | 'badgeMove'
  | 'badgeAdjust'
  | 'badgeShip'
  | 'location'
  | 'qty'
  | 'dragHint',
  string
> & { parts: Record<PartKey, string> };

export type Anchors = Partial<Record<AnchorKey, HTMLDivElement | null>>;

function Barcode() {
  const bars = [2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3];
  let x = 0;
  return (
    <svg width="118" height="34" viewBox="0 0 118 34" className={styles.barcode}>
      {bars.map((w, i) => {
        const bar = i % 2 === 0 ? <rect key={i} x={x} y="0" width={w * 1.8} height="34" /> : null;
        x += w * 1.8 + 1.8;
        return bar;
      })}
    </svg>
  );
}

/** The story cards only change with the phase, so hovering boxes (which
 *  re-renders Cards) skips them. */
const StoryCards = memo(function StoryCards({
  phase,
  labels,
  anchors,
  barRef,
}: {
  phase: Phase;
  labels: SceneLabels;
  anchors: RefObject<Anchors>;
  barRef: RefObject<HTMLSpanElement | null>;
}) {
  const anchor = (key: AnchorKey) => (el: HTMLDivElement | null) => {
    anchors.current[key] = el;
  };

  return (
    <>
      <div ref={anchor('receive')} className={styles.anchor}>
        <div className={`${styles.card} ${phase.scanned ? styles.done : styles.active}`}>
          <div className={styles.head}>
            <span className={styles.tag}>01 · {labels.receive}</span>
            <span className={styles.time}>09:13</span>
          </div>
          <div className={styles.viewfinder}>
            <Barcode />
            <span className={styles.mono}>BRK-2041</span>
            {!phase.scanned && <span className={styles.laser} />}
          </div>
          <div className={`${styles.result} ${phase.scanned ? styles.show : ''}`}>
            <CheckCircle2 size={13} strokeWidth={2.2} className={styles.ok} />
            <span className={styles.mono}>BRK-2041</span>
            <b className={styles.plus}>+12</b>
            <span className={styles.muted}>→ {SLOT_A03.label}</span>
          </div>
        </div>
      </div>

      <div ref={anchor('move')} className={styles.anchor}>
        <div className={`${styles.card} ${phase.moving ? styles.active : ''} ${phase.moved ? styles.done : ''}`}>
          <div className={styles.head}>
            <span className={styles.tag}>02 · {labels.move}</span>
            <span className={styles.time}>09:14</span>
          </div>
          <div className={styles.route}>
            <b className={styles.bin}>{SLOT_A03.label}</b>
            <span ref={barRef} className={styles.track}>
              <span className={styles.bar} />
              <Package size={12} strokeWidth={2.2} className={styles.parcel} />
            </span>
            <b className={`${styles.bin} ${phase.moved ? styles.binOn : ''}`}>{SLOT_B11.label}</b>
          </div>
          <p className={styles.meta}>
            12× <span className={styles.mono}>BRK-2041</span> · Rina
            {phase.moved && <CheckCircle2 size={12} strokeWidth={2.4} className={styles.ok} />}
          </p>
        </div>
      </div>

      <div ref={anchor('feed')} className={styles.anchor}>
        <div className={`${styles.card} ${styles.feed}`}>
          <div className={styles.head}>
            <span className={styles.tag}>03 · {labels.track}</span>
            <span className={styles.liveTag}>
              <i />
              {labels.liveActivity}
            </span>
          </div>
          <div className={styles.rows}>
            <div className={`${styles.row} ${styles.newRow} ${phase.moved ? styles.show : ''}`}>
              <span className={`${styles.avatar} ${styles.avBlue}`}>R</span>
              <span className={`${styles.badge} ${styles.bMove}`}>{labels.badgeMove}</span>
              <span className={styles.rowText}>12× {SLOT_A03.label} → {SLOT_B11.label}</span>
            </div>
            <div className={`${styles.row} ${styles.newRow} ${phase.scanned ? styles.show : ''}`}>
              <span className={`${styles.avatar} ${styles.avGreen}`}>B</span>
              <span className={`${styles.badge} ${styles.bReceive}`}>{labels.badgeReceive}</span>
              <span className={styles.rowText}>+12 BRK-2041</span>
            </div>
            <div className={styles.row}>
              <span className={`${styles.avatar} ${styles.avAmber}`}>S</span>
              <span className={`${styles.badge} ${styles.bAdjust}`}>{labels.badgeAdjust}</span>
              <span className={styles.rowText}>FLT-0187 9 → 4</span>
            </div>
            <div className={styles.row}>
              <span className={`${styles.avatar} ${styles.avViolet}`}>D</span>
              <span className={`${styles.badge} ${styles.bShip}`}>{labels.badgeShip}</span>
              <span className={styles.rowText}>DO-2210 · R-12</span>
            </div>
          </div>
        </div>
      </div>

      <div ref={anchor('alert')} className={styles.anchor}>
        <div className={`${styles.toast} ${phase.alert ? styles.show : ''}`}>
          <span className={styles.toastIcon}>
            <TriangleAlert size={13} strokeWidth={2.2} />
          </span>
          <span>
            <b>{labels.lowStock}</b>
            <span className={styles.muted}>
              <span className={styles.mono}>FLT-0187</span> · {labels.left}
            </span>
          </span>
        </div>
      </div>

      <div ref={anchor('slotA03')} className={styles.anchor}>
        <span className={`${styles.slotTag} ${phase.stored && !phase.moved ? styles.slotLit : ''}`}>{SLOT_A03.label}</span>
      </div>
      <div ref={anchor('slotB11')} className={styles.anchor}>
        <span className={`${styles.slotTag} ${phase.moved ? styles.slotLit : ''}`}>{SLOT_B11.label}</span>
      </div>
    </>
  );
});

export default function Cards({
  phase,
  labels,
  anchors,
  barRef,
  inspect,
  pinned,
  hint,
}: {
  phase: Phase;
  labels: SceneLabels;
  anchors: RefObject<Anchors>;
  barRef: RefObject<HTMLSpanElement | null>;
  inspect: StockInfo | null;
  pinned: boolean;
  hint: boolean;
}) {
  const anchor = (key: AnchorKey) => (el: HTMLDivElement | null) => {
    anchors.current[key] = el;
  };

  return (
    <div className={styles.overlay}>
      <StoryCards phase={phase} labels={labels} anchors={anchors} barRef={barRef} />

      {inspect && (
        <div ref={anchor('inspect')} className={styles.anchor}>
          <div className={`${styles.inspect} ${inspect.low ? styles.inspectLow : ''}`}>
            <div className={styles.head}>
              <span className={`${styles.mono} ${styles.inspectSku}`}>{inspect.sku}</span>
              {pinned && <Pin size={11} strokeWidth={2.4} className={styles.muted} />}
            </div>
            <p className={styles.inspectName}>{labels.parts[inspect.part]}</p>
            <div className={styles.inspectStats}>
              <span>
                <small>{labels.location}</small>
                <b className={styles.mono}>{inspect.loc}</b>
              </span>
              <span>
                <small>{labels.qty}</small>
                <b className={inspect.low ? styles.amberText : ''}>{inspect.qty}</b>
              </span>
            </div>
          </div>
        </div>
      )}

      <p className={`${styles.hint} ${hint ? styles.show : ''}`}>
        <Hand size={12} strokeWidth={2.2} />
        {labels.dragHint}
      </p>
    </div>
  );
}
