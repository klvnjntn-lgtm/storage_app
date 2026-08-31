// app/components/suppliers/SupplierForm.tsx
'use client';

import { SupplierFormValues } from './types';

type Props = {
  values: SupplierFormValues;
  onChange: (values: SupplierFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitLabel: string;
  error: string;
};

export function SupplierForm({ values, onChange, onSubmit, submitting, submitLabel, error }: Props) {
  function set<K extends keyof SupplierFormValues>(key: K, value: SupplierFormValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-4"
    >
      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</p>
      )}

      <div>
        <label className="block text-sm font-semibold mb-1">
          Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={values.name}
          onChange={(e) => set('name', e.target.value)}
          className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
          placeholder="Supplier or company name"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Contact person</label>
          <input
            type="text"
            value={values.contactName}
            onChange={(e) => set('contactName', e.target.value)}
            className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">Phone</label>
          <input
            type="tel"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold mb-1">Email</label>
          <input
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold mb-1">NPWP</label>
          <input
            type="text"
            value={values.npwp}
            onChange={(e) => set('npwp', e.target.value)}
            className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Address</label>
        <textarea
          value={values.address}
          onChange={(e) => set('address', e.target.value)}
          rows={2}
          className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold mb-1">Notes</label>
        <textarea
          value={values.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          className="w-full border-2 border-gray-300 focus:border-black rounded-md px-3 py-2 text-sm outline-none resize-none"
          placeholder="Payment terms, delivery notes, etc."
        />
      </div>

      <button
        type="submit"
        disabled={submitting || !values.name.trim()}
        className="w-full sm:w-auto bg-black text-white font-semibold px-6 py-2.5 rounded-md hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? 'Saving...' : submitLabel}
      </button>
    </form>
  );
}