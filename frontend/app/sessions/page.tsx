'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Calendar, Package } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';

type Session = {
  id: string;
  type: string;
  status: string;
  totalItems: number;
  createdAt: string;
};

const statusStyle = (status: string) => {
  switch (status?.toUpperCase()) {
    case 'OPEN':
    case 'IN_PROGRESS':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'COMPLETE':
    case 'DONE':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'CANCELLED':
      return 'bg-gray-100 text-gray-600 border-gray-300';
    default:
      return 'bg-gray-100 text-gray-600 border-gray-300';
  }
};

export default function SessionsPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const res = await apiFetch(
          'http://localhost:3000/sessions'
        );

        const data = await res.json();

        setSessions(data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    loadSessions();
  }, []);

  return (
<main className="min-h-screen bg-white text-black">

  {/* Header */}
  <div className="px-6 py-5 border-b-2 border-gray-300">
    <div className="max-w-5xl mx-auto">
      <button
        onClick={() => router.push('/home')}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-3"
      >
        <ArrowLeft size={16} strokeWidth={2} />
        Back to Scanner Hub
      </button>

      <div className="flex items-center gap-2">
        <ClipboardList size={22} strokeWidth={2} className="text-gray-700" />
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-xs text-gray-500">Warehouse activity history</p>
        </div>
      </div>
    </div>
  </div>

      {/* Content */}
      <div className="p-6 max-w-5xl mx-auto">

        {loading && (
          <div className="text-gray-500 text-sm">
            Loading sessions...
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="text-gray-500 text-sm">
            No sessions found.
          </div>
        )}

        <div className="space-y-2">

          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => router.push(`/sessions/${session.id}`)}
              className="cursor-pointer bg-white border-2 border-gray-300 rounded-md p-4 hover:bg-gray-50 transition"
            >
              <div className="flex justify-between items-center">

                <div>
                  <p className="font-semibold">
                    {session.type}
                  </p>

                  <p className="flex items-center gap-1 text-xs text-gray-500 mt-1">
                    <Calendar size={12} strokeWidth={2} />
                    {new Date(session.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="text-right">
                  <p className="flex items-center justify-end gap-1 text-sm font-medium">
                    <Package size={14} strokeWidth={2} className="text-gray-500" />
                    {session.totalItems} items
                  </p>

                  <span
                    className={`inline-block mt-1 text-xs px-2 py-0.5 rounded-md border font-medium ${statusStyle(session.status)}`}
                  >
                    {session.status}
                  </span>
                </div>

              </div>
            </div>
          ))}

        </div>

      </div>
    </main>
  );
}