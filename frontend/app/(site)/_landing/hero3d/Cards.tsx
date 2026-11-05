'use client';

import { memo, type CSSProperties, type RefObject } from 'react';
import { CheckCircle2, Hand, Pin, ScanBarcode, Truck } from 'lucide-react';
import { SLOT_PICK, type Phase } from './timeline';
import { solutionByKey, type SolutionKey } from '../solutions';
import type { AnchorKey } from './Story';
import type { PartKey, StockInfo } from './Warehouse';
import styles from './Hero3D.module.css';

/* ─── Floating UI over the canvas ────────────────────────────────────
   Plain DOM in the page's own React tree. Story's projector moves each
   anchor onto its 3D point every frame. */

export const SCENE_LABEL_KEYS = [
  'warehouse',
  'sales',
  'workshop',
  'delivery',
  'scanning',
  'shelved',
  'invoicing',
  'paid',
  'loading',
  'onRoute',
  'delivered',
  'inService',
  'serviceDone',
  'location',
  'qty',
  'dragHint',
] as const;

export type SceneLabels = Record<(typeof SCENE_LABEL_KEYS)[number], string> & { parts: Record<PartKey, string> };

export type Anchors = Partial<Record<AnchorKey, HTMLDivElement | null>>;

function Tag({ zone, label }: { zone: SolutionKey; label: string }) {
  const Icon = solutionByKey(zone).icon;
  return (
    <span className={styles.tag}>
      <Icon size={10} strokeWidth={2.4} />
      {label}
    </span>
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
  const cardCls = (zone: SolutionKey, done: boolean) =>
    `${styles.card} ${phase.zone === zone ? styles.active : ''} ${done ? styles.done : ''}`;
  const tint = (zone: SolutionKey) => ({ '--zone': solutionByKey(zone).rgb }) as CSSProperties;

  return (
    <>
      <div ref={anchor('warehouse')} className={styles.anchor} style={tint('warehouse')}>
        <div className={cardCls('warehouse', phase.stored)}>
          <div className={styles.head}>
            <Tag zone="warehouse" label={labels.warehouse} />
            <span className={styles.time}>09:13</span>
          </div>
          <p className={styles.line}>
            <span className={styles.mono}>SKU-2041</span>
            <b className={styles.plus}>{phase.scanned ? '+12' : '…'}</b>
          </p>
          <p className={styles.meta}>
            {phase.stored ? <CheckCircle2 size={12} strokeWidth={2.4} className={styles.ok} /> : <ScanBarcode size={12} strokeWidth={2.2} />}
            {phase.stored ? `${labels.shelved} ${SLOT_PICK.label}` : labels.scanning}
          </p>
        </div>
      </div>

      <div ref={anchor('sales')} className={styles.anchor} style={tint('sales')}>
        <div className={cardCls('sales', phase.paid)}>
          <div className={styles.head}>
            <Tag zone="sales" label={labels.sales} />
            <span className={styles.time}>09:20</span>
          </div>
          <p className={styles.line}>
            <span className={styles.mono}>INV-2291</span>
            <b>Rp 2.450.000</b>
          </p>
          <p className={styles.meta}>
            {phase.paid && <CheckCircle2 size={12} strokeWidth={2.4} className={styles.ok} />}
            {phase.paid ? labels.paid : labels.invoicing}
          </p>
        </div>
      </div>

      <div ref={anchor('delivery')} className={styles.anchor} style={tint('delivery')}>
        <div className={cardCls('delivery', phase.delivered)}>
          <div className={styles.head}>
            <Tag zone="delivery" label={labels.delivery} />
            <span className={styles.time}>10:05</span>
          </div>
          <p className={styles.line}>
            <span className={styles.mono}>DO-0418</span>
            <span ref={barRef} className={styles.track}>
              <span className={styles.bar} />
              <Truck size={12} strokeWidth={2.2} className={styles.parcel} />
            </span>
          </p>
          <p className={styles.meta}>
            {phase.delivered && <CheckCircle2 size={12} strokeWidth={2.4} className={styles.ok} />}
            {phase.delivered ? labels.delivered : phase.loaded ? labels.onRoute : labels.loading}
          </p>
        </div>
      </div>

      <div ref={anchor('workshop')} className={styles.anchor} style={tint('workshop')}>
        <div className={cardCls('workshop', phase.serviced)}>
          <div className={styles.head}>
            <Tag zone="workshop" label={labels.workshop} />
            <span className={styles.time}>10:40</span>
          </div>
          <p className={styles.line}>
            <span className={styles.plate}>B 1234 KJT</span>
            <span className={styles.muted}>WO-118</span>
          </p>
          <p className={styles.meta}>
            {phase.serviced && <CheckCircle2 size={12} strokeWidth={2.4} className={styles.ok} />}
            {phase.serviced ? labels.serviceDone : labels.inService}
          </p>
        </div>
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
