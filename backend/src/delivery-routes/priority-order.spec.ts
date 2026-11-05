import { DeliveryPriority } from '@prisma/client';
import { highPriorityFirst, priorityInversions } from './priority-order';

const { HIGH, NORMAL } = DeliveryPriority;
type S = { id: string; p: DeliveryPriority; done?: boolean };
const priorityOf = (s: S) => s.p;
const isPending = (s: S) => !s.done;

describe('highPriorityFirst', () => {
  it('moves HIGH stops up and keeps the order within each group', () => {
    const stops: S[] = [
      { id: 'n1', p: NORMAL },
      { id: 'h1', p: HIGH },
      { id: 'n2', p: NORMAL },
      { id: 'h2', p: HIGH },
    ];
    expect(highPriorityFirst(stops, priorityOf).map((s) => s.id)).toEqual(['h1', 'h2', 'n1', 'n2']);
  });

  it('leaves finished stops where they are', () => {
    const stops: S[] = [
      { id: 'doneN', p: NORMAL, done: true },
      { id: 'n1', p: NORMAL },
      { id: 'doneH', p: HIGH, done: true },
      { id: 'h1', p: HIGH },
    ];
    expect(highPriorityFirst(stops, priorityOf, isPending).map((s) => s.id)).toEqual([
      'doneN',
      'h1',
      'doneH',
      'n1',
    ]);
  });
});

describe('priorityInversions', () => {
  it('counts normal stops ahead of HIGH ones, ignoring finished stops', () => {
    const stops: S[] = [
      { id: 'doneN', p: NORMAL, done: true },
      { id: 'n1', p: NORMAL },
      { id: 'h1', p: HIGH },
      { id: 'n2', p: NORMAL },
      { id: 'h2', p: HIGH },
    ];
    expect(priorityInversions(stops, priorityOf, isPending)).toBe(3);
    expect(priorityInversions(stops.slice(2, 3), priorityOf, isPending)).toBe(0);
  });
});
