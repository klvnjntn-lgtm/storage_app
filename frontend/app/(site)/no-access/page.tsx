'use client';

import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import LanguageSwitcher from '@/app/components/shared/LanguageSwitcher';

export default function NoAccessPage() {
  const router = useRouter();
  const { t } = useLanguage();

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <ShieldAlert size={40} strokeWidth={1.5} className="mx-auto text-gray-400" />
        <div>
          <h1 className="text-xl font-bold">{t('auth.noAccess.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {t('auth.noAccess.message')}
          </p>
        </div>
        <button
          onClick={() => router.push('/home')}
          className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold"
        >
          {t('auth.noAccess.backToHub')}
        </button>
      </div>
    </main>
  );
}