import { fixIsTimely } from '../customers/customer-pin-backfill';
import { onServerClock, photoCaptureData } from './driver-proof';

describe('photoCaptureData — phone clock running ahead', () => {
  const now = new Date('2026-11-14T03:00:00Z');
  const phone = (ms: number) => new Date(now.getTime() + ms).toISOString();

  it('keeps the gap between GPS reading and photo when the photo time is pulled back', () => {
    // Phone 40 s fast; reading 2 s before the photo.
    const data = photoCaptureData(
      { takenAt: phone(40_000), locationAt: phone(38_000), latitude: 1.1, longitude: 104, accuracy: 8 },
      true,
      null,
      now,
    );
    expect(data.proofPhotoTakenAt).toEqual(now);
    expect(data.proofPhotoLocationAt).toEqual(new Date(now.getTime() - 2_000));
    expect(fixIsTimely(data.proofPhotoLocationAt, data.proofPhotoTakenAt)).toBe(true);
  });

  it('leaves times alone when the phone is not ahead', () => {
    const data = photoCaptureData(
      { takenAt: phone(-60_000), locationAt: phone(-61_000), latitude: 1.1, longitude: 104 },
      true,
      null,
      now,
    );
    expect(data.proofPhotoLocationAt).toEqual(new Date(phone(-61_000)));
  });
});

describe('onServerClock', () => {
  it('moves a phone time by however much the signing time was pulled back', () => {
    const raw = new Date('2026-11-14T03:00:30Z');
    const stored = new Date('2026-11-14T03:00:00Z');
    expect(onServerClock(new Date('2026-11-14T03:00:28Z'), raw, stored)).toEqual(new Date('2026-11-14T02:59:58Z'));
    expect(onServerClock(raw, undefined, stored)).toEqual(raw);
  });
});
