// Per-user, per-browser tour progress in localStorage — the same place
// the app keeps theme and language. Keyed by user so two people sharing
// a warehouse tablet each get their own first-use prompt.

export type TourRecord = {
  status?: 'completed' | 'skipped';
  promptDismissed?: boolean;
};

// Keyed by tour id: module overviews ('ops', 'pos', …) and page tours
// ('delivery.routes', …).
export type TourState = Partial<Record<string, TourRecord>>;

const PREFIX = 'waresys.tours.v1';

const keyFor = (userKey: string) => `${PREFIX}:${userKey}`;

export function readTourState(userKey: string): TourState {
  try {
    const raw = localStorage.getItem(keyFor(userKey));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeTourRecord(userKey: string, id: string, patch: TourRecord): TourState {
  const next = { ...readTourState(userKey) };
  next[id] = { ...next[id], ...patch };
  try {
    localStorage.setItem(keyFor(userKey), JSON.stringify(next));
  } catch {
    // storage blocked — progress just won't persist
  }
  return next;
}
