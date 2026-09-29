'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/app/context/ThemeContext';
import { useLanguage } from '@/app/context/LanguageContext';

export default function ThemeToggle({ className = '', dark = false }: { className?: string; dark?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const label = theme === 'dark' ? t('theme.switchToLight') : t('theme.switchToDark');

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={`grid place-items-center h-[30px] w-[30px] shrink-0 rounded-md border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
        dark
          ? 'border-white/15 text-white/75 hover:bg-white/10 hover:border-white/30'
          : 'border-blue-500/20 text-gray-600 hover:bg-blue-50 hover:border-blue-500/40'
      } ${className}`}
    >
      {/* both icons render; CSS picks one so SSR markup matches before the theme is known */}
      <Sun size={15} strokeWidth={2} aria-hidden="true" className="theme-icon-sun" />
      <Moon size={15} strokeWidth={2} aria-hidden="true" className="theme-icon-moon" />
    </button>
  );
}
