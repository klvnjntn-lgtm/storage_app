// The driver's stop search, forgiving the way the parts catalogue search is
// (backend/src/part-catalog/part-query.ts, whose typo rules these mirror): every
// word typed has to be on the stop, in any order, with spacing and punctuation
// ignored ("do0042", "tokomaju"). Typos only count when nothing matches as typed,
// or "jaya" would also list every "Jl. Raya".
//
// A number that is exactly a stop's position in the route puts that stop first,
// since it also tends to match house numbers; after that, stops still to be done
// come before finished ones, each in route order.
export type SearchableStop = {
  sequence: number;
  status: string;
  label: string;
  customerName: string | null;
  doNumber: string | null;
  address: string | null;
  addressLabel: string | null;
};

const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// Typos allowed per word: none for short words or anything with digits (codes,
// numbers), else 1, or 2 from 8 letters.
const allowedTypos = (word: string) => (/\d/.test(word) || word.length <= 3 ? 0 : word.length >= 8 ? 2 : 1);

// Edit distance where swapping two neighbouring letters counts as one typo.
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// Also against the word's start, so a typo counts while still typing it.
const nearlyIs = (typed: string, word: string) => {
  const max = allowedTypos(typed);
  return (
    max > 0 &&
    (editDistance(typed, word) <= max || (word.length > typed.length && editDistance(typed, word.slice(0, typed.length)) <= max))
  );
};

export function matchStops<T extends SearchableStop>(stops: T[], query: string): T[] {
  const typed = wordsOf(query);
  if (typed.length === 0) return [];

  const searchable = stops.map((stop, index) => {
    const words = wordsOf(
      [stop.sequence, stop.label, stop.customerName, stop.doNumber, stop.addressLabel, stop.address].join(' '),
    );
    return { stop, index, words, text: words.join(' '), squeezed: words.join('') };
  });

  const exact = searchable.filter(
    (s) => typed.every((word) => s.text.includes(word)) || s.squeezed.includes(typed.join('')),
  );
  const found = exact.length
    ? exact
    : searchable.filter((s) => typed.every((word) => s.words.some((w) => nearlyIs(word, w))));

  const rank = (stop: T) =>
    (typed.length === 1 && typed[0] === String(stop.sequence) ? 0 : 2) + (stop.status === 'PENDING' ? 0 : 1);

  return found.sort((a, b) => rank(a.stop) - rank(b.stop) || a.index - b.index).map((s) => s.stop);
}
