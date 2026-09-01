// app/(app)/purchasing/suppliers/new/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2 } from 'lucide-react';
import { apiFetch } from '@/lib/apifetch';
import { SupplierForm } from '@/app/components/suppliers/SupplierForm';
import { emptySupplierFormValues, SupplierFormValues } from '@/app/components/suppliers/types';

export default function NewSupplierPage() {
  const router = useRouter();
  const [values, setValues] = useState<SupplierFormValues>(emptySupplierFormValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const res = await apiFetch('/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name.trim(),
          contactName: values.contactName.trim() || undefined,
          phone: values.phone.trim() || undefined,
          email: values.email.trim() || undefined,
          address: values.address.trim() || undefined,
          npwp: values.npwp.trim() || undefined,
          notes: values.notes.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? `Request failed (${res.status})`);
        return;
      }
      router.push('/purchasing/suppliers');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur px-4 sm:px-6 py-4 sm:py-5 border-b-2 border-gray-300">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => router.push('/purchasing/suppliers')}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-black mb-2 sm:mb-3 -ml-1 py-1 px-1 active:bg-gray-100 rounded-md"
          >
            <ArrowLeft size={16} strokeWidth={2} />
            Back to suppliers
          </button>

          <div className="flex items-center gap-2">
            <Building2 size={20} strokeWidth={2} className="text-gray-700" />
            <h1 className="text-xl sm:text-2xl font-bold">New Supplier</h1>
          </div>
        </div>
      </div>

      <div className="max-w-xl mx-auto p-4 sm:p-6">
        <SupplierForm
          values={values}
          onChange={setValues}
          onSubmit={handleSubmit}
          submitting={submitting}
          submitLabel="Create Supplier"
          error={error}
        />
      </div>
    </main>
  );
}