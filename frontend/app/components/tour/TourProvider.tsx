'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { CircleCheck, Clock, Play } from 'lucide-react';
import { useAuth } from '@/app/context/AuthContext';
import { useLanguage } from '@/app/context/LanguageContext';
import { tourForPath, tours, type TourModuleId } from './tours';
import { getTour, pageTourForPath } from './registry';
import { arrowRightSvg, checkSvg, moduleSvg, tourIcon } from './tourIcons';
import { readTourState, writeTourRecord, type TourRecord, type TourState } from './tourStorage';

type TourContextValue = {
  /** The module overview for where the user is, if the org has the module. */
  currentTour: TourModuleId | null;
  /** A deeper tour of the current page, if there is one. */
  currentPageTour: string | null;
  record: (id: string) => TourRecord;
  startTour: (id: string) => void;
};

const TourContext = createContext<TourContextValue>({
  currentTour: null,
  currentPageTour: null,
  record: () => ({}),
  startTour: () => {},
});

export const useTour = () => useContext(TourContext);

// The first visible match — the same data-tour can exist in both the
// desktop sidebar and the mobile top bar, and only one is on screen.
function findVisible(selector: string): Element | undefined {
  return Array.from(document.querySelectorAll(selector)).find((el) => el.getClientRects().length > 0);
}

// Starting from another page in the module navigates to the tour's page
// first; wait for its targets to mount instead of guessing a delay.
function waitForTargets(selectors: string[], timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      if (selectors.length === 0 || selectors.some((s) => findVisible(s)) || Date.now() - started > timeoutMs) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });
}

const PROMPT_DELAY_MS = 900;
const DONE_TOAST_MS = 4000;

const el = (tag: string, className: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
};

export function TourProvider({ enabledModules, children }: { enabledModules: string[]; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useLanguage();

  const userKey = profile ? String(profile.id ?? profile.email) : null;
  // What's in storage for this user, overridden by our own writes since.
  const loaded = useMemo(() => (userKey ? readTourState(userKey) : {}), [userKey]);
  const [saved, setSaved] = useState<{ userKey: string; state: TourState } | null>(null);
  const state = saved && saved.userKey === userKey ? saved.state : loaded;

  const [active, setActive] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [promptReadyFor, setPromptReadyFor] = useState<string | null>(null);
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const driverRef = useRef<Driver | null>(null);
  const startingRef = useRef(false);
  const endRef = useRef<(() => void) | null>(null);

  const moduleId = tourForPath(pathname);
  const currentTour =
    moduleId && tours[moduleId].steps.length > 0 && enabledModules.includes(tours[moduleId].requiresModule)
      ? moduleId
      : null;

  const pageTourId = pageTourForPath(pathname);
  const pageTour = pageTourId ? getTour(pageTourId) : null;
  const currentPageTour =
    pageTour && pageTour.steps.length > 0 && enabledModules.includes(tours[pageTour.module].requiresModule)
      ? pageTourId
      : null;

  const record = useCallback((id: string) => state[id] ?? {}, [state]);

  const save = useCallback(
    (id: string, patch: TourRecord) => {
      if (userKey) setSaved({ userKey, state: writeTourRecord(userKey, id, patch) });
    },
    [userKey],
  );

  const run = useCallback(
    async (id: string) => {
      // One start at a time — the pending-navigation effect can fire
      // again while we're still waiting for targets.
      const config = getTour(id);
      if (!config || startingRef.current || driverRef.current?.isActive()) return;
      startingRef.current = true;
      await waitForTargets(config.steps.flatMap((s) => (s.target ? [s.target] : [])));
      setPending(null);
      startingRef.current = false;
      if (!config.matches(window.location.pathname)) return;

      const steps: DriveStep[] = config.steps.flatMap((step) => {
        const popover = { title: t(step.title), description: t(step.description), side: step.side };
        if (!step.target) return [{ popover }];
        const target = step.target;
        const el = findVisible(target);
        if (!el) return [];
        // Re-resolve on highlight in case React re-rendered the node.
        return [{ element: () => findVisible(target) ?? el, popover }];
      });
      if (steps.length === 0) return;

      // Every exit goes through here exactly once. driver.js only fires
      // onDestroyed after a step has finished highlighting, so an early
      // Escape would otherwise go unrecorded. Skip, Escape and leaving
      // the page count as skipped — but skipping a replay doesn't undo an
      // earlier completion.
      let ended = false;
      const end = (completed: boolean) => {
        if (ended) return;
        ended = true;
        const wasCompleted = !!userKey && readTourState(userKey)[id]?.status === 'completed';
        save(id, { status: completed || wasCompleted ? 'completed' : 'skipped', promptDismissed: true });
        d.destroy();
        driverRef.current = null;
        endRef.current = null;
        setActive(null);
        if (completed) setDoneFor(id);
      };

      const moduleName = t(config.title);

      const d = driver({
        steps,
        animate: true,
        smoothScroll: true,
        overlayColor: '#0b1220',
        overlayOpacity: 0.7,
        stagePadding: 8,
        stageRadius: 14,
        popoverOffset: 14,
        popoverClass: 'waresys-tour',
        // The page underneath is for looking at, not clicking, while the
        // tour runs; a stray click on the dim overlay shouldn't end it.
        disableActiveInteraction: true,
        overlayClickBehavior: () => {},
        showButtons: ['next', 'previous'],
        nextBtnText: t('tour.next'),
        prevBtnText: t('tour.back'),
        doneBtnText: t('tour.finish'),
        // driver.js rebuilds the popover for every step; dress it up here:
        // segmented progress + "Step 3 of 8", a module chip, a bigger
        // centred card for steps with no target, and icon buttons.
        onPopoverRender: (popover, { state }) => {
          const index = state.activeIndex ?? 0;
          const isIntro = !d.getActiveStep()?.element;
          popover.wrapper.classList.toggle('is-intro', isIntro);

          const head = el('div', 'waresys-tour-head');
          const bar = el('div', 'waresys-tour-bar');
          bar.setAttribute('aria-hidden', 'true');
          steps.forEach((_, i) => bar.append(el('span', i <= index ? 'is-done' : '')));
          const meta = el('div', 'waresys-tour-meta');
          const chip = el('span', 'waresys-tour-chip');
          chip.innerHTML = moduleSvg(config.module, 13);
          chip.append(t('tour.chip', { module: moduleName }));
          meta.append(chip, el('span', 'waresys-tour-count', t('tour.counter', { current: index + 1, total: steps.length })));
          head.append(bar, meta);
          popover.wrapper.insertBefore(head, popover.title);

          if (isIntro) {
            const badge = el('div', 'waresys-tour-badge');
            badge.innerHTML = moduleSvg(config.module, 26);
            popover.wrapper.insertBefore(badge, popover.title);
          }

          const skip = el('button', 'waresys-tour-skip', t('tour.skip')) as HTMLButtonElement;
          skip.type = 'button';
          skip.addEventListener('click', () => end(false));
          popover.footer.insertBefore(skip, popover.footer.firstChild);

          const isLast = index === steps.length - 1;
          popover.nextButton.innerHTML = '';
          popover.nextButton.append(el('span', '', isLast ? t('tour.finish') : t('tour.next')));
          popover.nextButton.insertAdjacentHTML('beforeend', isLast ? checkSvg : arrowRightSvg);
          // driver.js sets an inline display:block on its buttons; the icon
          // layout needs flex, and the first step has nothing to go back to.
          popover.nextButton.style.display = 'inline-flex';
          popover.previousButton.style.display = index === 0 ? 'none' : 'inline-flex';

          // Keyboard users land on the primary action every step.
          popover.nextButton.focus({ preventScroll: true });
        },
        onDoneClick: () => end(true),
        // Escape (and any other driver-initiated close).
        onDestroyStarted: () => end(false),
      });
      driverRef.current = d;
      endRef.current = () => end(false);
      setActive(id);
      d.drive();
    },
    [t, save, userKey],
  );

  const startTour = useCallback(
    (id: string) => {
      const config = getTour(id);
      if (!config || driverRef.current?.isActive()) return;
      save(id, { promptDismissed: true });
      // Page tours run where they are; module overviews have a home page.
      if (!config.startPath || config.matches(pathname)) {
        run(id);
      } else {
        setPending(id);
        router.push(config.startPath);
      }
    },
    [pathname, router, run, save],
  );

  // Finish a start that had to navigate first.
  useEffect(() => {
    if (pending && getTour(pending)?.matches(pathname)) run(pending);
  }, [pending, pathname, run]);

  // Leaving the tour's page (e.g. browser Back) ends it cleanly.
  useEffect(() => {
    if (active && !getTour(active)?.matches(pathname)) endRef.current?.();
  }, [active, pathname]);

  useEffect(() => () => endRef.current?.(), []);

  useEffect(() => {
    if (!doneFor) return;
    const timer = setTimeout(() => setDoneFor(null), DONE_TOAST_MS);
    return () => clearTimeout(timer);
  }, [doneFor]);

  // First-use prompt, after a beat so it doesn't flash while the page
  // loads. The module overview comes first. A page tour is only suggested
  // to people who finished that overview (they've shown they like tours);
  // everyone else finds page tours in the Help menu, marked "New".
  const fresh = (id: string | null) => !!id && !state[id]?.status && !state[id]?.promptDismissed;
  const promptTour = !userKey || active || pending
    ? null
    : fresh(currentTour)
      ? currentTour
      : currentPageTour && fresh(currentPageTour) && state[getTour(currentPageTour)!.module]?.status === 'completed'
        ? currentPageTour
        : null;
  const wantsPrompt = !!promptTour;
  useEffect(() => {
    if (!promptTour) return;
    const timer = setTimeout(() => setPromptReadyFor(promptTour), PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [promptTour]);
  const promptConfig = promptTour ? getTour(promptTour) : null;

  return (
    <TourContext.Provider value={{ currentTour, currentPageTour, record, startTour }}>
      {children}
      {wantsPrompt && promptConfig && promptReadyFor === promptTour && (
        <FirstUsePrompt
          id={promptConfig.module}
          kind={promptConfig.kind}
          moduleName={t(promptConfig.title)}
          onStart={() => startTour(promptConfig.id)}
          onDismiss={() => save(promptConfig.id, { promptDismissed: true })}
        />
      )}
      <div role="status" aria-live="polite" className="contents">
        {doneFor && <DoneToast moduleName={t(getTour(doneFor)?.title ?? '')} />}
      </div>
    </TourContext.Provider>
  );
}

// Non-blocking: no overlay, no focus steal, sits above the mobile tab bar.
function FirstUsePrompt({
  id,
  kind,
  moduleName,
  onStart,
  onDismiss,
}: {
  id: TourModuleId;
  kind: 'module' | 'page';
  moduleName: string;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLanguage();
  const Icon = tourIcon[id];
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="tour-prompt-title"
      aria-describedby="tour-prompt-body"
      className="fixed z-40 right-4 left-4 sm:left-auto sm:w-[360px] bottom-[calc(var(--app-bottom-nav-h,0px)+1rem)] rounded-2xl border border-blue-500/20 bg-white shadow-2xl shadow-blue-950/20 overflow-hidden animate-tour-prompt-in motion-reduce:animate-none"
    >
      <div className="relative px-5 pt-5 pb-4 bg-gradient-to-br from-blue-600 to-indigo-700 text-white">
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-20"
          style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '14px 14px' }}
        />
        <div className="relative flex items-center gap-3">
          <span className="shrink-0 w-11 h-11 rounded-xl bg-white/15 ring-1 ring-white/25 grid place-items-center">
            <Icon size={22} strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-[12px] font-medium text-white/85">
              <Clock size={12} strokeWidth={2.25} aria-hidden="true" />
              {t(kind === 'page' ? 'tour.prompt.pageEyebrow' : 'tour.prompt.eyebrow')}
            </p>
            <p id="tour-prompt-title" className="text-[17px] font-bold leading-tight mt-0.5">
              {t(kind === 'page' ? 'tour.prompt.pageTitle' : 'tour.prompt.title', { module: moduleName })}
            </p>
          </div>
        </div>
      </div>
      <div className="px-5 pt-3.5 pb-5">
        <p id="tour-prompt-body" className="text-sm leading-relaxed text-gray-600">
          {t(kind === 'page' ? 'tour.prompt.pageBody' : 'tour.prompt.body', { module: moduleName })}
        </p>
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-11 px-4 rounded-lg border border-blue-500/20 text-sm font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-700 active:scale-[0.98] transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {t('tour.prompt.later')}
          </button>
          <button
            type="button"
            onClick={onStart}
            className="flex-1 min-h-11 inline-flex items-center justify-center gap-2 px-4 rounded-lg bg-blue-600 text-white text-sm font-semibold shadow-sm shadow-blue-600/30 hover:bg-blue-700 active:scale-[0.98] transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <Play size={15} strokeWidth={2.25} aria-hidden="true" className="fill-current" />
            {t('tour.prompt.start')}
          </button>
        </div>
      </div>
    </div>
  );
}

// Brief confirmation after Finish; announced politely, never takes focus.
function DoneToast({ moduleName }: { moduleName: string }) {
  const { t } = useLanguage();
  return (
    <div className="fixed z-40 right-4 left-4 sm:left-auto sm:w-[340px] bottom-[calc(var(--app-bottom-nav-h,0px)+1rem)] flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-white shadow-xl shadow-emerald-900/10 p-4 animate-tour-prompt-in motion-reduce:animate-none">
      <CircleCheck size={22} strokeWidth={2} aria-hidden="true" className="shrink-0 text-emerald-600" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">{t('tour.done.title', { module: moduleName })}</p>
        <p className="text-[13px] text-gray-600 mt-0.5">{t('tour.done.body')}</p>
      </div>
    </div>
  );
}
