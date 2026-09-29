'use client';

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
};

const STORAGE_KEY = 'theme';
const MEDIA = '(prefers-color-scheme: dark)';

/* Runs in <head> before first paint (see (site)/layout.tsx) so the page
   never flashes the wrong theme. A saved choice wins; otherwise follow
   the OS setting. Keep in sync with readStored/apply below. */
export const themeInitScript = `(function(){try{var s=localStorage.getItem('${STORAGE_KEY}');var t=s==='light'||s==='dark'?s:(matchMedia('${MEDIA}').matches?'dark':'light');var d=document.documentElement;d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}})();`;

function readStored(): Theme | null {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s === 'light' || s === 'dark' ? s : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia(MEDIA).matches ? 'dark' : 'light';
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

/* The <html data-theme> attribute is the source of truth; React just
   subscribes to it. */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
const getServerSnapshot = (): Theme => 'light';

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Track the OS setting until the user picks a theme themselves.
  useEffect(() => {
    const mq = window.matchMedia(MEDIA);
    const onChange = () => {
      if (!readStored()) apply(systemTheme());
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = getSnapshot() === 'dark' ? 'light' : 'dark';
    apply(next);
    try {
      // Toggling back to what the OS already asks for drops the override,
      // so the page follows the system setting again.
      if (next === systemTheme()) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage blocked — the choice just won't persist
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
