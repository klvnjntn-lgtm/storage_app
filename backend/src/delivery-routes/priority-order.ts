import { DeliveryPriority } from '@prisma/client';

// HIGH priority stops come before normal ones among the stops still to do.
// Finished stops are history and hold their place; the rest flow around them.
// Within each group the current order is kept, so a stop made HIGH lands below
// the HIGH stops already there, and one taken off HIGH above the normal stops.
export function highPriorityFirst<T>(
  stops: T[],
  priorityOf: (stop: T) => DeliveryPriority,
  isPending: (stop: T) => boolean = () => true,
): T[] {
  const pending = stops.filter(isPending);
  const isHigh = (stop: T) => priorityOf(stop) === DeliveryPriority.HIGH;
  const ordered = [...pending.filter(isHigh), ...pending.filter((s) => !isHigh(s))];
  let next = 0;
  return stops.map((stop) => (isPending(stop) ? ordered[next++] : stop));
}

// How many normal/HIGH pairs are the wrong way round. A reorder may not raise
// this, which still lets someone tidy a route that's already out of order
// instead of leaving every move on it refused.
export function priorityInversions<T>(
  stops: T[],
  priorityOf: (stop: T) => DeliveryPriority,
  isPending: (stop: T) => boolean = () => true,
): number {
  let normalsSeen = 0;
  let inversions = 0;
  for (const stop of stops) {
    if (!isPending(stop)) continue;
    if (priorityOf(stop) === DeliveryPriority.HIGH) inversions += normalsSeen;
    else normalsSeen++;
  }
  return inversions;
}
