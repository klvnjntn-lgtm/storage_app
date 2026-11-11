'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useLanguage } from '@/app/context/LanguageContext';
import { useDialog } from '@/app/components/shared/DialogProvider';
import { googleMapsUrl } from './GoogleMapsLink';

type Coord = number | string | null | undefined;

export type CopyableStop = {
  sequence: number;
  label: string;
  addressLabel: string | null;
  address: string | null;
  destinationLatitude: Coord;
  destinationLongitude: Coord;
  deliveryNotes: string | null;
  phone: string | null;
  // Set by the API only when the customer has landmark photos.
  shareToken: string | null;
};

// The text that goes onto the clipboard, ready for a WhatsApp chat:
//   #3 Toko Sinar Jaya
//   Gudang Timur · Jl. Melati 12
//   Phone: 0812…
//   Notes: blue gate behind the mosque
//
//   Maps: https://www.google.com/maps/search/?api=1&query=…
//
//   Location photos: https://…/stop/<token>
// Each link gets a blank line before it, so it stands apart in the chat.
export function stopCopyText(
  stop: CopyableStop,
  origin: string,
  t: (key: string) => string,
): string {
  const k = (key: string) => t(`delivery.routeDetail.${key}`);
  const lines = [`#${stop.sequence} ${stop.label}`];
  const where = [stop.addressLabel, stop.address].filter(Boolean).join(' · ');
  if (where) lines.push(where);
  if (stop.phone?.trim()) lines.push(`${k('copyPhone')}: ${stop.phone.trim()}`);
  if (stop.deliveryNotes?.trim()) lines.push(`${k('copyNotes')}: ${stop.deliveryNotes.trim()}`);
  // Where the stop is — never where the driver happened to mark it delivered.
  const maps = googleMapsUrl(stop.destinationLatitude, stop.destinationLongitude);
  if (maps) lines.push('', `${k('copyMaps')}: ${maps}`);
  if (stop.shareToken) lines.push('', `${k('copyPhotos')}: ${origin}/stop/${stop.shareToken}`);
  return lines.join('\n');
}

// Old browsers, and plain-http pages other than localhost, have no
// navigator.clipboard.
function legacyCopy(text: string): boolean {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.appendChild(el);
  el.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    el.remove();
  }
}

// One button per route stop: everything needed to get there, on the clipboard.
// The text is built from data already on the page, so the copy happens
// straight from the click — Safari refuses a clipboard write that waits on a
// request first.
export default function CopyStopButton({ stop }: { stop: CopyableStop }) {
  const { t } = useLanguage();
  const dialog = useDialog();
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    const text = stopCopyText(stop, window.location.origin, t);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      // fall through to the legacy way
    }
    if (!ok) ok = legacyCopy(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      await dialog.alert(`${t('delivery.routeDetail.copyStopFailed')}\n\n${text}`);
    }
  }

  // Icon only, the same size as the stop card's other icon buttons (edit,
  // move, delete). The tick says it worked; screen readers hear it below.
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={t('delivery.routeDetail.copyStop')}
      title={copied ? t('delivery.routeDetail.stopCopied') : t('delivery.routeDetail.copyStopTitle')}
      className={`p-2 sm:p-1 rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        copied
          ? 'border-green-300 bg-green-50 text-green-700'
          : 'border-gray-200 text-gray-500 hover:text-gray-800 hover:bg-gray-50'
      }`}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      <span role="status" className="sr-only">
        {copied ? t('delivery.routeDetail.stopCopied') : ''}
      </span>
    </button>
  );
}
