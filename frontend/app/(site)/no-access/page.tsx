'use client';

import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

export default function NoAccessPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-white text-black flex items-center justify-center px-6">
      <div className="max-w-sm text-center space-y-4">
        <ShieldAlert size={40} strokeWidth={1.5} className="mx-auto text-gray-400" />
        <div>
          <h1 className="text-xl font-bold">No access</h1>
          <p className="text-sm text-gray-500 mt-1">
            You don&apos;t have permission to view this page. If you think this is a mistake, contact an admin.
          </p>
        </div>
        <button
          onClick={() => router.push('/home')}
          className="px-4 py-2 bg-black text-white rounded-md text-sm font-semibold"
        >
          Back to Hub
        </button>
      </div>
    </main>
  );
}