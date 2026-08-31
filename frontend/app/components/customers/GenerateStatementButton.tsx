// app/components/customers/GenerateStatementButton.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, X } from 'lucide-react';

// A statement is a per-customer running account (opening balance, period
// activity, closing balance) — there's no meaningful "all customers"
// version of that. For an org-wide view, use /reports instead.
type Props = {
  customerId: string;
  customerName: string;
};

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { label: 'This month', from: () => { const d = new Date(); d.setDate(1); return d; } },
  { label: 'Last month', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return d; }, to: () => { const d = new Date(); d.setDate(0); return d; } },
  { label: 'Last 3 months', from: () => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d; } },
  { label: 'This year', from: () => { const d = new Date(); d.setMonth(0, 1); return d; } },
];

export function GenerateStatementButton({ customerId, customerName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return toDateInput(d);
  });
  const [to, setTo] = useState(toDateInput(new Date()));

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setFrom(toDateInput(preset.from()));
    setTo(toDateInput(preset.to ? preset.to() : new Date()));
  }

  function generate() {
    const params = new URLSearchParams({ from, to, customerId, customerName });
    router.push(`/sales/statement?${params}`);
    setOpen(false);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-md border-2 border-black font-semibold hover:bg-gray-100"
      >
        <FileText size={16} strokeWidth={2} />
        Generate Statement
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-lg w-full max-w-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-lg">Statement for {customerName}</h2>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-black">
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex gap-2 mb-4">
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs font-semibold text-gray-600">From</label>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm w-full"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-xs font-semibold text-gray-600">To</label>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="border-2 border-gray-300 rounded-md p-2 text-sm w-full"
                />
              </div>
            </div>

            <button
              onClick={generate}
              className="w-full flex items-center justify-center gap-2 bg-black text-white rounded-md p-2 text-sm font-semibold hover:bg-gray-800"
            >
              Generate
            </button>
          </div>
        </div>
      )}
    </>
  );
}