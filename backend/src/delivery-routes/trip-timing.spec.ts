import { fitTiming } from './trip-timing';

// Pairs generated from a known truth: gap = factor × road + stop.
const make = (factor: number, stop: number, roads: number[]) =>
  roads.map((r) => ({ roadSeconds: r, gapSeconds: factor * r + stop }));

describe('fitTiming', () => {
  it('recovers the stop minutes and travel factor', () => {
    const neighbours = make(1.4, 420, Array.from({ length: 12 }, (_, i) => 20 + i * 5));
    const trips = make(1.4, 420, Array.from({ length: 20 }, (_, i) => 300 + i * 60));
    expect(fitTiming([...neighbours, ...trips], 300)).toEqual({
      travelFactor: 1.4,
      stopMinutes: 7,
      neighbourPairs: 12,
      tripPairs: 20,
    });
  });

  it('is not thrown by a lunch break, a reload or several orders at one stop', () => {
    const good = [
      ...make(1.2, 300, Array.from({ length: 12 }, () => 30)),
      ...make(1.2, 300, Array.from({ length: 20 }, (_, i) => 400 + i * 30)),
    ];
    const noise = [
      { roadSeconds: 600, gapSeconds: 2 * 3600 }, // lunch
      { roadSeconds: 0, gapSeconds: 15 }, // second DO, same stop
      { roadSeconds: 500, gapSeconds: 5000 },
    ];
    expect(fitTiming([...good, ...noise], 300)).toMatchObject({ travelFactor: 1.2, stopMinutes: 5 });
  });

  it('suggests nothing without enough deliveries', () => {
    expect(fitTiming(make(1.5, 300, [30, 500, 900]), 300)).toMatchObject({ travelFactor: null, stopMinutes: null });
  });

  it('uses the current stop time when it cannot measure one', () => {
    const trips = make(2, 600, Array.from({ length: 20 }, (_, i) => 300 + i * 60));
    expect(fitTiming(trips, 600)).toMatchObject({ travelFactor: 2, stopMinutes: null });
  });
});
