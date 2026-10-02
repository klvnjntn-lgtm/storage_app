import { ServiceUnavailableException } from '@nestjs/common';

// Every PDF render launches its own headless Chromium (~100–200MB each).
// Without a cap, a burst of PDF requests — or one user holding down a
// download button — could launch dozens at once and take the server down.
// Renders past MAX_CONCURRENT wait their turn; past MAX_QUEUED the request
// is refused rather than piling up.
const MAX_CONCURRENT = Number(process.env.PDF_MAX_CONCURRENT ?? 2);
const MAX_QUEUED = 20;

let active = 0;
const waiting: (() => void)[] = [];

export async function withPdfRenderSlot<T>(render: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUED) {
      throw new ServiceUnavailableException('Too many documents are being generated right now — try again shortly');
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    active++;
  }
  try {
    return await render();
  } finally {
    // Hand the slot straight to the next waiter (active stays the same);
    // only free it when nobody is queued.
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}
