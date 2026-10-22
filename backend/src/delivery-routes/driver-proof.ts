// src/delivery-routes/driver-proof.ts
import { BadRequestException } from '@nestjs/common';

// Rules for a delivery a DRIVER records from the phone (customer stops and
// DO stops alike). Office staff recording proof at a desk aren't held to
// them.

// The phone keeps an unfinished delivery for this long (driverDrafts on
// the frontend); a time older than that isn't one of its drafts.
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Small allowance for a phone clock a few minutes behind the server's.
const CLOCK_SLACK_MS = 10 * 60 * 1000;

// The delivery time is when the proof photo was taken, not when Done was
// tapped. From the phone's clock, so: one running ahead is pulled back to
// now, one implausibly far back is refused, and so is one from before the
// delivery could have happened (notBefore: the route's day for a customer
// stop, the shipping time for a delivery order) — a phone set to the
// wrong date.
export function driverSignedAt(
  raw: Date | undefined,
  notBefore?: Date | null,
  now = new Date(),
): Date {
  if (!raw || Number.isNaN(raw.getTime())) return now;
  if (raw > now) return now;
  if (now.getTime() - raw.getTime() > MAX_AGE_MS) {
    throw new BadRequestException(
      'This delivery time is too far back — take a new proof photo',
    );
  }
  if (notBefore && raw.getTime() < notBefore.getTime() - CLOCK_SLACK_MS) {
    throw new BadRequestException(
      "The phone's date or time looks wrong — check it in the phone's settings, then take the photo again",
    );
  }
  return raw;
}

// A driver's delivery is placed by GPS; a weak reading is fine, none isn't.
export function assertDriverLocation(
  latitude: number | undefined | null,
  longitude: number | undefined | null,
) {
  if (latitude == null || longitude == null) {
    throw new BadRequestException(
      'A GPS location is required to record a delivery',
    );
  }
}

// What a proof photo upload stores besides the photo: when and where it
// was taken (GPS required from a driver), and the receiver name if one
// came along. Same columns on DeliveryOrder and RouteStop.
export function photoCaptureData(
  meta: {
    takenAt?: string;
    latitude?: number;
    longitude?: number;
    accuracy?: number;
    receivedBy?: string;
  },
  isDriver: boolean,
  notBefore?: Date | null,
) {
  if (isDriver) assertDriverLocation(meta.latitude, meta.longitude);
  const requested = meta.takenAt ? new Date(meta.takenAt) : undefined;
  const hasFix = meta.latitude != null && meta.longitude != null;
  const name = meta.receivedBy?.trim();
  return {
    proofPhotoTakenAt: isDriver
      ? driverSignedAt(requested, notBefore)
      : (requested ?? new Date()),
    proofPhotoLatitude: hasFix ? meta.latitude : null,
    proofPhotoLongitude: hasFix ? meta.longitude : null,
    proofPhotoAccuracy: hasFix ? (meta.accuracy ?? null) : null,
    ...(name ? { pendingReceivedBy: name } : {}),
  };
}

// On a failed attempt: the photo taken at the stop moves to the failure
// (so a rescheduled delivery doesn't start with it as proof) and what came
// with it is cleared. No photo → nothing changes.
export function movePhotoToFailure(proofPhotoKey: string | null) {
  if (!proofPhotoKey) return {};
  return {
    failurePhotoKey: proofPhotoKey,
    proofPhotoKey: null,
    proofPhotoTakenAt: null,
    proofPhotoLatitude: null,
    proofPhotoLongitude: null,
    proofPhotoAccuracy: null,
    pendingReceivedBy: null,
  };
}
