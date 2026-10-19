import { useEffect, useRef } from 'react';

// Escape closes a modal or drawer while it's open. Always calls the latest
// onClose, so callers can pass an inline arrow. A dialog stacked on top
// (DialogProvider) stops the key first, so Escape there closes only it.
export function useEscapeToClose(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}
