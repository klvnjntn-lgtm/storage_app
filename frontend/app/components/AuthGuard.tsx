'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const PUBLIC_PATHS = ['/', '/login', '/register'];

const checkIsPublic = (pathname: string) =>
  PUBLIC_PATHS.some((p) =>
    p === '/' ? pathname === '/' : pathname.startsWith(p)
  );

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const isPublic = checkIsPublic(pathname);
    const token = localStorage.getItem('accessToken');

    if (!token && !isPublic) {
      router.replace('/login');
      return;
    }

    if (token && isPublic) {
  const isAuthPage = pathname === '/login' || pathname === '/register';
  if (isAuthPage) {
    router.replace('/home');
    return;
  }
}

    setChecked(true);
  }, [pathname, router]);

  const isPublic = checkIsPublic(pathname);

  if (!checked && !isPublic) {
    return (
      <main className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    );
  }

  return <>{children}</>;
}