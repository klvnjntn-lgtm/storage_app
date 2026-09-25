'use client';

import { useRef, type CSSProperties } from 'react';
import {
  ScanBarcode,
  ArrowLeftRight,
  Activity,
  Users,
  History,
  FileSpreadsheet,
  Package,
  CheckCircle2,
  Boxes,
  Truck,
  Calculator,
  Warehouse,
  ArrowRight,
} from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { SpotlightCard, Stagger, StaggerItem, useAnimState } from './primitives';
import styles from './FeatureBento.module.css';

/* ─── "Everything your stock team needs" as a bento grid. Every tile
   carries a small, true-to-product visual instead of an icon + check:
   the two loops (scan, transfer) are the only things that move; the
   rest respond to hover. Visuals are decorative (aria-hidden); the
   tile title and sub are the real content. ─────────────────────── */

function TileHead({ icon: Icon, title, sub }: { icon: typeof ScanBarcode; title: string; sub: string }) {
  return (
    <div className="relative">
      <span className={styles.iconChip}>
        <Icon size={17} strokeWidth={2} aria-hidden="true" />
      </span>
      <h3 className="mt-4 text-[17px] font-semibold tracking-[-0.01em] text-white">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-white/60">{sub}</p>
    </div>
  );
}

/* Scanner phone + receiving log: every 6s a scan lands and logs a row. */
function ScanVisual() {
  const { t } = useLanguage();
  const rows = [
    { sku: 'BRK-2041', name: t('landing.scene.items.brakePads'), qty: '+12', loc: 'A-03', time: '09:14', fresh: true },
    { sku: 'FLT-0187', name: t('landing.scene.items.oilFilter'), qty: '+40', loc: 'B-11', time: '08:52' },
    { sku: 'SPK-1120', name: t('landing.scene.items.sparkPlug'), qty: '+96', loc: 'C-02', time: '08:30' },
    { sku: 'BRG-0876', name: t('landing.scene.items.wheelBearing'), qty: '+6', loc: 'B-04', time: '08:05' },
  ];
  return (
    <div className={styles.scanStage} aria-hidden="true">
      <div className={styles.phone}>
        <span className={styles.notch} />
        <div className={styles.phoneScreen}>
          <div className={styles.cam}>
            <div className={styles.box}>
              <div className={styles.boxLabel}>
                <svg width="96" height="30" viewBox="0 0 96 30">
                  {[2, 1, 3, 1, 1, 2, 1, 3, 2, 1, 1, 2, 3, 1, 2, 1, 1, 3, 1, 2].reduce<{ x: number; els: React.ReactElement[] }>(
                    (acc, w, i) => {
                      if (i % 2 === 0) acc.els.push(<rect key={i} x={acc.x} y="0" width={w * 1.7} height="30" fill="#0f172a" />);
                      acc.x += w * 1.7 + 1.7;
                      return acc;
                    },
                    { x: 0, els: [] },
                  ).els}
                </svg>
                <span>BRK-2041 · 12 PCS</span>
              </div>
            </div>
            <span className={styles.reticle} />
            <span className={styles.laser} />
            <span className={styles.camFlash} />
          </div>
          <div className={styles.toastOk}>
            <CheckCircle2 size={12} strokeWidth={2.4} />
            <span>+12</span> BRK-2041
          </div>
          <div className={styles.shutterRow}>
            <span className={styles.shutter} />
            <span className={styles.shutterLabel}>{t('landing.features.visual.scan')}</span>
          </div>
        </div>
      </div>

      <div className={styles.log}>
        <div className={styles.logHead}>
          <span>{t('landing.features.visual.receivedToday')}</span>
          <span className={styles.logCount}>+154</span>
        </div>
        <div className={styles.logViewport}>
          <div className={styles.logList}>
            {rows.map((r) => (
              <div key={r.sku} className={`${styles.logRow} ${r.fresh ? styles.logFresh : ''}`}>
                <span className={styles.logIcon}>
                  <Package size={12} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={styles.mono}>{r.sku}</span>
                  <span className={styles.logName}>{r.name}</span>
                </span>
                <span className={styles.logQty}>{r.qty}</span>
                <span className={styles.logLoc}>→ {r.loc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Two racks and a parcel riding the path between them. */
function TransferVisual() {
  return (
    <div className={styles.transfer} aria-hidden="true">
      <div className={styles.rack}>
        <span className={styles.shelf}>
          <i />
          <i className={styles.shelfItemDim} />
        </span>
        <span className={styles.shelf}>
          <i />
          <i />
          <i />
        </span>
        <span className={styles.shelf}>
          <i className={styles.shelfItemDim} />
        </span>
        <b>A-03</b>
      </div>
      <svg className={styles.transferPath} viewBox="0 0 300 120" preserveAspectRatio="none">
        <path d="M 78 70 C 120 12, 180 12, 222 70" />
      </svg>
      <span className={styles.transferParcel}>
        <Package size={13} strokeWidth={2.2} />
      </span>
      <div className={`${styles.rack} ${styles.rackTo}`}>
        <span className={styles.shelf}>
          <i />
          <i />
        </span>
        <span className={styles.shelf}>
          <i className={styles.shelfItemDim} />
          <i />
        </span>
        <span className={`${styles.shelf} ${styles.shelfLanding}`}>
          <i />
        </span>
        <b>B-11</b>
      </div>
      <p className={styles.transferMeta}>
        <span className={styles.mono}>12× BRK-2041</span>
        <span className="text-white/35">·</span> Rina <span className="text-white/35">·</span> 09:14
      </p>
    </div>
  );
}

/* Live counts per location as bars; the low one reads amber. */
function TrackingVisual() {
  const locs = [
    { name: 'Bay 1', value: '1,204', pct: 100 },
    { name: 'Bay 3', value: '864', pct: 72 },
    { name: 'Rack A2', value: '412', pct: 36 },
    { name: 'Rack C1', value: '96', pct: 9, low: true },
  ];
  return (
    <div className={styles.bars} aria-hidden="true">
      {locs.map((l, i) => (
        <div key={l.name} className={styles.barRow}>
          <span className={styles.barName}>{l.name}</span>
          <span className={styles.barTrack}>
            <span
              className={`${styles.barFill} ${l.low ? styles.barLow : ''}`}
              style={{ '--pct': `${l.pct}%`, '--i': i } as CSSProperties}
            />
          </span>
          <span className={`${styles.barValue} ${l.low ? 'text-amber-400' : ''}`}>{l.value}</span>
        </div>
      ))}
    </div>
  );
}

/* Team members, their role, and which modules each can open. */
function RolesVisual() {
  const { t } = useLanguage();
  const modules = [Boxes, ArrowLeftRight, Truck, Calculator];
  const people = [
    { init: 'R', name: 'Rina W.', role: t('landing.features.visual.roleAdmin'), tone: styles.roleAdmin, av: '#2563eb', on: [0, 1, 2, 3] },
    { init: 'B', name: 'Budi S.', role: t('landing.features.visual.roleStaff'), tone: styles.roleStaff, av: '#059669', on: [0, 1] },
    { init: 'D', name: 'Dedi P.', role: t('landing.features.visual.roleDriver'), tone: styles.roleDriver, av: '#7c3aed', on: [2] },
  ];
  return (
    <div className={styles.people} aria-hidden="true">
      {people.map((p) => (
        <div key={p.name} className={styles.person}>
          <span className={styles.avatar} style={{ background: p.av }}>
            {p.init}
          </span>
          <span className={styles.personName}>{p.name}</span>
          <span className={`${styles.role} ${p.tone}`}>{p.role}</span>
          <span className={styles.perms}>
            {modules.map((Icon, i) => (
              <span key={i} className={`${styles.perm} ${p.on.includes(i) ? styles.permOn : ''}`}>
                <Icon size={11} strokeWidth={2} />
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Audit trail as a timeline — who did what, when. */
function AuditVisual() {
  const { t } = useLanguage();
  const events = [
    { badge: t('landing.scene.badgeMove'), tone: styles.tMove, text: 'BRK-2041 A-03 → B-11', who: 'Rina', time: '09:14' },
    { badge: t('landing.scene.badgeReceive'), tone: styles.tReceive, text: '+12 BRK-2041', who: 'Budi', time: '09:13' },
    { badge: t('landing.scene.badgeAdjust'), tone: styles.tAdjust, text: 'FLT-0187 9 → 4', who: 'Sari', time: '09:02' },
  ];
  return (
    <div className={styles.timeline} aria-hidden="true">
      {events.map((e, i) => (
        <div key={e.time} className={styles.event}>
          <span className={`${styles.dot} ${i === 0 ? styles.dotLive : ''}`} />
          <span className={`${styles.eventBadge} ${e.tone}`}>{e.badge}</span>
          <span className={styles.eventText}>{e.text}</span>
          <span className={styles.eventMeta}>
            {e.who} · {e.time}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Spreadsheet in, live inventory out. */
function ImportVisual() {
  const { t } = useLanguage();
  return (
    <div className={styles.import} aria-hidden="true">
      <div className={styles.importFlow}>
        <span className={styles.file}>
          <FileSpreadsheet size={15} strokeWidth={2} />
          <span className={styles.mono}>inventory.xlsx</span>
        </span>
        <span className={styles.flowArrow}>
          <ArrowRight size={14} strokeWidth={2} />
        </span>
        <span className={styles.importMark}>
          <Warehouse size={14} strokeWidth={2.2} />
        </span>
      </div>
      <div className={styles.progress}>
        <span className={styles.progressFill} />
      </div>
      <p className={styles.importMeta}>
        <CheckCircle2 size={13} strokeWidth={2.4} className="text-emerald-400" />
        <span className="font-semibold text-white tabular-nums">1,284</span> {t('landing.features.visual.imported')}
      </p>
    </div>
  );
}

export default function FeatureBento() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const anim = useAnimState(ref);
  const f = (key: string) => t(`landing.features.items.${key}`);

  return (
    <div ref={ref} data-anim={anim}>
      <Stagger className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <StaggerItem className="md:col-span-2 lg:row-span-2">
          <SpotlightCard className="h-full p-6 sm:p-8 flex flex-col">
            <div className="flex items-start justify-between gap-4">
              <TileHead icon={ScanBarcode} title={f('barcodeReceiving.label')} sub={f('barcodeReceiving.sub')} />
              <span className={styles.coreBadge}>core</span>
            </div>
            <div className="mt-8 flex-1 flex items-end lg:items-center">
              <ScanVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>

        <StaggerItem>
          <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col">
            <TileHead icon={ArrowLeftRight} title={f('transfers.label')} sub={f('transfers.sub')} />
            <div className="mt-6 flex-1 flex items-end">
              <TransferVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>

        <StaggerItem>
          <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col">
            <TileHead icon={Activity} title={f('tracking.label')} sub={f('tracking.sub')} />
            <div className="mt-6 flex-1 flex items-end">
              <TrackingVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>

        <StaggerItem>
          <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col" glow="167, 139, 250">
            <TileHead icon={Users} title={f('multiUser.label')} sub={f('multiUser.sub')} />
            <div className="mt-6 flex-1 flex items-end">
              <RolesVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>

        <StaggerItem>
          <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col">
            <TileHead icon={History} title={f('auditLogs.label')} sub={f('auditLogs.sub')} />
            <div className="mt-6 flex-1 flex items-end">
              <AuditVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>

        <StaggerItem className="md:col-span-2 lg:col-span-1">
          <SpotlightCard className="h-full p-6 sm:p-7 flex flex-col" glow="52, 211, 153">
            <TileHead icon={FileSpreadsheet} title={f('onboarding.label')} sub={f('onboarding.sub')} />
            <div className="mt-6 flex-1 flex items-end">
              <ImportVisual />
            </div>
          </SpotlightCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
