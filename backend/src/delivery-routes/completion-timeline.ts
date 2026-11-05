// A driver's finished stops in the order they actually happened, whatever the
// route's planned order was, each with the time it took: since the previous
// stop was finished, or since the planned departure for the first one. No
// departure on the route (or one after the first finish) leaves the first
// stop's time null, because nothing records when a driver really set off.
export function completionTimeline<T extends { at: Date; sequence: number }>(
  finished: T[],
  plannedDepartureAt: Date | null,
): (T & { durationSeconds: number | null })[] {
  const ordered = [...finished].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || a.sequence - b.sequence,
  );
  return ordered.map((stop, i) => {
    const since = i > 0 ? ordered[i - 1].at : plannedDepartureAt;
    const ms = since ? stop.at.getTime() - since.getTime() : null;
    return {
      ...stop,
      durationSeconds: ms != null && ms >= 0 ? Math.round(ms / 1000) : null,
    };
  });
}
