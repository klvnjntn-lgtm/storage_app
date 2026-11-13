import { OFF_PIN_METERS, offPin } from './off-pin';

const pin = { destinationLatitude: 1.13, destinationLongitude: 104.05 };
// ~111 m per 0.001° of latitude.
const at = (dLat: number, accuracy: number | null = 10) => ({
  ...pin,
  completedLatitude: 1.13 + dLat,
  completedLongitude: 104.05,
  completedAccuracy: accuracy,
  markedByOffice: false,
});

describe('offPin', () => {
  it('measures the distance and flags one well past the limit', () => {
    expect(offPin(at(0.0005))).toEqual({ meters: 56, far: false });
    expect(offPin(at(0.004))).toMatchObject({ far: true });
  });

  it("excuses what the reading's accuracy explains, up to a point", () => {
    // ~245 m away
    expect(offPin(at(0.0022, 10))?.far).toBe(true);
    expect(offPin(at(0.0022, 60))?.far).toBe(false);
    // a ±2 km reading doesn't excuse 400 m
    expect(offPin(at(0.0036, 2000))?.far).toBe(true);
    expect(OFF_PIN_METERS).toBe(200);
  });

  it('says nothing without a pin or a reading, or for an office-set result', () => {
    expect(offPin({ ...at(0.01), destinationLatitude: null })).toBeNull();
    expect(offPin({ ...at(0.01), completedLatitude: null })).toBeNull();
    expect(offPin({ ...at(0.01), markedByOffice: true })).toBeNull();
  });
});
