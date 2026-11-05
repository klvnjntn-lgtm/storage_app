import { completionTimeline } from './completion-timeline';

const at = (time: string) => new Date(`2026-11-06T${time}:00Z`);

describe('completionTimeline', () => {
  it('orders by finish time, not route order, and keeps each stop its route number', () => {
    const result = completionTimeline(
      [
        { sequence: 1, at: at('10:30') },
        { sequence: 3, at: at('09:15') },
        { sequence: 2, at: at('09:45') },
      ],
      at('09:00'),
    );
    expect(result.map((s) => [s.sequence, s.durationSeconds])).toEqual([
      [3, 15 * 60],
      [2, 30 * 60],
      [1, 45 * 60],
    ]);
  });

  it('has no time for the first stop without a usable departure', () => {
    const stops = [
      { sequence: 1, at: at('09:15') },
      { sequence: 2, at: at('09:45') },
    ];
    for (const departure of [null, at('09:30')]) {
      expect(completionTimeline(stops, departure).map((s) => s.durationSeconds)).toEqual([
        null,
        30 * 60,
      ]);
    }
  });
});
