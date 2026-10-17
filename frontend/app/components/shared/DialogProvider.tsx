'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/app/context/LanguageContext';

// In-app replacements for window.confirm/alert/prompt, which looked foreign
// next to the app's own dialogs (and especially so in the installed PWA).
// Promise-based so call sites keep their shape:
//   if (!(await dialog.confirm(msg, { danger: true }))) return;

type ConfirmOptions = { danger?: boolean; confirmLabel?: string };
type PromptOptions = { defaultValue?: string; confirmLabel?: string };

type Request = { id: number; message: string } & (
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'alert'; resolve: () => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
);
type NewRequest = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

let nextId = 0;

type DialogApi = {
  confirm: (message: string, opts?: ConfirmOptions) => Promise<boolean>;
  alert: (message: string) => Promise<void>;
  prompt: (message: string, opts?: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialog must be used inside <DialogProvider>');
  return api;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  // A queue, so two dialogs requested back to back show one after another.
  const [queue, setQueue] = useState<Request[]>([]);
  const [api] = useState<DialogApi>(() => {
    const push = (r: NewRequest) => setQueue((q) => [...q, { ...r, id: nextId++ } as Request]);
    return {
      confirm: (message, opts = {}) => new Promise((resolve) => push({ kind: 'confirm', message, opts, resolve })),
      alert: (message) => new Promise((resolve) => push({ kind: 'alert', message, resolve })),
      prompt: (message, opts = {}) => new Promise((resolve) => push({ kind: 'prompt', message, opts, resolve })),
    };
  });

  const current = queue[0] ?? null;
  const close = useCallback(() => setQueue((q) => q.slice(1)), []);

  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogView key={current.id} request={current} onDone={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ request, onDone }: { request: Request; onDone: () => void }) {
  const { t } = useLanguage();
  const [value, setValue] = useState(request.kind === 'prompt' ? (request.opts.defaultValue ?? '') : '');
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function finish(ok: boolean) {
    if (request.kind === 'confirm') request.resolve(ok);
    else if (request.kind === 'alert') request.resolve();
    else request.resolve(ok ? value : null);
    onDone();
  }

  useEffect(() => {
    (request.kind === 'prompt' ? inputRef.current : confirmRef.current)?.focus();
  }, [request.kind]);

  const danger = request.kind === 'confirm' && request.opts.danger;
  const confirmLabel =
    request.kind === 'alert'
      ? t('common.ok')
      : (request.opts.confirmLabel ?? (request.kind === 'prompt' ? t('common.ok') : t('common.confirm')));

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={() => finish(false)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-describedby="app-dialog-message"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            finish(false);
          }
        }}
        className="bg-white w-full sm:max-w-md rounded-t-xl sm:rounded-xl border border-blue-500/15 shadow-xl p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-5 animate-sheet-in motion-reduce:animate-none"
      >
        <p id="app-dialog-message" className="text-sm text-gray-800 whitespace-pre-line">
          {request.message}
        </p>
        {request.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish(true);
            }}
            className="mt-3 w-full border-2 border-gray-300 focus:border-blue-500 rounded-md px-3 py-2 text-sm outline-none"
          />
        )}
        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {request.kind !== 'alert' && (
            <button
              onClick={() => finish(false)}
              className="px-4 py-2.5 sm:py-2 rounded-md border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            ref={confirmRef}
            onClick={() => finish(true)}
            className={`px-4 py-2.5 sm:py-2 rounded-md text-sm font-semibold text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
