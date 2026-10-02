'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleHelp, Compass, MessageCircle, Check, BookOpen } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { WHATSAPP_URL } from '@/lib/support';
import { useTour } from './TourProvider';
import { tours } from './tours';
import { tourIcon } from './tourIcons';
import { getTour } from './registry';

/**
 * The module's Help entry point: replay its tour or reach support.
 * Renders nothing outside a module that has a tour. `sidebar` is a full
 * row for the desktop sidebar footer (menu opens upward); `icon` is a
 * compact square matching ThemeToggle for the mobile top bar.
 */
export default function TourHelpMenu({ variant }: { variant: 'sidebar' | 'icon' }) {
  const { t } = useLanguage();
  const { currentTour, currentPageTour, record, startTour } = useTour();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!currentTour) return null;

  const moduleName = t(tours[currentTour].title);
  const status = record(currentTour).status;
  const completed = status === 'completed';
  const pageTitle = currentPageTour ? t(getTour(currentPageTour)?.title ?? '') : null;
  const pageStatus = currentPageTour ? record(currentPageTour).status : undefined;
  // Untaken (not finished, not skipped): the entry point invites the tour —
  // the module overview first, then this page's own tour.
  const moduleFresh = !status;
  const pageFresh = !!currentPageTour && !pageStatus;
  const fresh = moduleFresh || pageFresh;
  const ModuleIcon = tourIcon[currentTour];
  const itemClass =
    'w-full flex items-center gap-3 px-2.5 py-2.5 min-h-12 text-left rounded-lg hover:bg-blue-50 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600';
  const label = fresh ? `${t('tour.help.label')} · ${t('tour.help.newBadge')}` : t('tour.help.label');

  return (
    <div ref={ref} className={`relative ${variant === 'sidebar' ? 'w-full' : ''}`}>
      {variant === 'sidebar' ? (
        <button
          ref={buttonRef}
          type="button"
          data-tour="help-menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="group w-full flex items-center gap-3 px-2.5 py-2 rounded-xl border border-blue-500/20 bg-gradient-to-r from-blue-50 to-indigo-50/60 hover:border-blue-500/40 hover:shadow-sm hover:shadow-blue-600/10 text-left transition cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <span className="relative shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white grid place-items-center shadow-sm shadow-blue-600/30">
            <Compass size={17} strokeWidth={2} aria-hidden="true" />
            {fresh && (
              <span aria-hidden="true" className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-white motion-safe:animate-pulse" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[13.5px] font-semibold text-gray-900">
              <span className="truncate">{moduleFresh
                  ? t('tour.help.cardTitle', { module: moduleName })
                  : pageFresh
                    ? t('tour.help.pageCardTitle')
                    : t('tour.help.sidebarLabel')}</span>
              {fresh && (
                <span className="shrink-0 px-1.5 py-px rounded-full bg-amber-100 text-amber-800 text-[10.5px] font-bold uppercase tracking-wide">
                  {t('tour.help.newBadge')}
                </span>
              )}
            </span>
            <span className="block text-xs text-gray-600 truncate">
              {moduleFresh ? t('tour.help.cardHint') : pageFresh ? pageTitle : t('tour.help.cardDoneHint')}
            </span>
          </span>
          <CircleHelp size={16} strokeWidth={2} aria-hidden="true" className="shrink-0 text-blue-600/60 group-hover:text-blue-700 transition-colors" />
        </button>
      ) : (
        <button
          ref={buttonRef}
          type="button"
          data-tour="help-menu"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={label}
          title={label}
          // 30px to match ThemeToggle; the ::before extends the hit area to 44px.
          className="relative grid place-items-center h-[30px] w-[30px] shrink-0 rounded-md border border-blue-500/30 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-500/50 transition-colors cursor-pointer before:absolute before:-inset-[7px] before:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <CircleHelp size={16} strokeWidth={2.25} aria-hidden="true" />
          {fresh && (
            <span aria-hidden="true" className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white motion-safe:animate-pulse" />
          )}
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-72 rounded-xl border border-blue-500/15 bg-white p-1.5 shadow-xl shadow-blue-950/15 animate-tour-menu-in motion-reduce:animate-none ${
            variant === 'sidebar' ? 'left-0 bottom-full mb-2 origin-bottom-left' : 'right-0 top-full mt-2 origin-top-right'
          }`}
        >
          {currentPageTour && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                startTour(currentPageTour);
              }}
              className={itemClass}
            >
              <span className="shrink-0 w-9 h-9 rounded-lg bg-blue-50 border border-blue-500/25 text-blue-700 grid place-items-center">
                <BookOpen size={17} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  {t('tour.help.pageTour')}
                  {pageFresh && (
                    <span className="px-1.5 py-px rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wide">
                      {t('tour.help.newBadge')}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  {pageStatus === 'completed' && <Check size={12} strokeWidth={2.5} aria-hidden="true" className="text-emerald-600" />}
                  <span className="truncate">{pageTitle}</span>
                </span>
              </span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              startTour(currentTour);
            }}
            className={itemClass}
          >
            <span className="shrink-0 w-9 h-9 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white grid place-items-center">
              <ModuleIcon size={17} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">{t('tour.help.tutorial', { module: moduleName })}</span>
              <span className="flex items-center gap-1 text-xs text-gray-600">
                {completed && <Check size={12} strokeWidth={2.5} aria-hidden="true" className="text-emerald-600" />}
                {completed ? t('tour.help.tutorialDone') : t('tour.help.tutorialHint')}
              </span>
            </span>
          </button>
          <div className="my-1 mx-2.5 border-t border-blue-500/10" />
          <a
            role="menuitem"
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            <span className="shrink-0 w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-500/20 text-emerald-700 grid place-items-center">
              <MessageCircle size={17} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-gray-900">{t('tour.help.support')}</span>
              <span className="block text-xs text-gray-600">{t('tour.help.supportHint')}</span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
