'use client';

import { useEffect, useState } from 'react';

// How the invoice / quotation / sales order editors are laid out:
// - office:  the document gets the wide column (fields two per row, roomy lines) and the product
//            search sits in a narrow side panel — for businesses writing documents for customers.
// - retail:  the search fills the page and the document is a narrow cart beside it — for a counter
//            ringing up many quick sales.
// Remembered per device; Office unless this device picked Cashier.
export type DocumentLayout = 'office' | 'retail';

const KEY = 'waresys:documentLayout';
const CHANGED = 'waresys:document-layout-changed';

function read(): DocumentLayout {
  try {
    return localStorage.getItem(KEY) === 'retail' ? 'retail' : 'office';
  } catch {
    return 'office';
  }
}

export function useDocumentLayout() {
  const [layout, setLayoutState] = useState<DocumentLayout>('office');
  useEffect(() => {
    const sync = () => setLayoutState(read());
    sync();
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  const setLayout = (next: DocumentLayout) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // storage unavailable — just this page then
    }
    setLayoutState(next);
    window.dispatchEvent(new Event(CHANGED));
  };
  return { layout, setLayout };
}

// The editors' grid for each layout, at the same page width (max-w-5xl) as every other page. The two
// are mirror images — a wide column and a 360px one — and Office puts the document (marked with
// documentOrder) first on wide screens; on phones both stack with the search on top, as before.
export function documentGridClass(layout: DocumentLayout) {
  return layout === 'office'
    ? 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start'
    : 'grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start';
}
export const documentOrder = 'lg:order-first';
