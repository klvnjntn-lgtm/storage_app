// Finding customers that already exist before a new one is saved — from the
// New form, the customer picker's quick add, or a spreadsheet import.
//
// Two levels:
// - exact copy: same name and same address (both compared loosely, see
//   below), or the same NPWP. Never saved twice.
// - similar: same name at another address, a name that reads almost the
//   same, or the same phone number. Saved only after someone confirms —
//   branches of one business (LB Technologies Kantin B 05 / B 08) are real
//   separate customers, and so are two "Toko Abadi"s across town.
//
// Names compare without case, punctuation, word order or legal-form words,
// so "Bumi Indoneisa, PT" and "PT Bumi Indoneisa" are the same name.

export type DuplicateReason = 'SAME_NAME_ADDRESS' | 'SAME_NPWP' | 'SAME_NAME' | 'SIMILAR_NAME' | 'SAME_PHONE';

export type DuplicateMatch = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  reason: DuplicateReason;
};

export type DuplicateCheck = { exact: DuplicateMatch[]; similar: DuplicateMatch[] };

export type DuplicateCandidate = {
  name: string;
  address?: string | null;
  phone?: string | null;
  npwp?: string | null;
};

type Existing = { id: string; name: string; address: string | null; phone: string | null; npwp: string | null };

// Legal forms add nothing to telling customers apart.
const LEGAL_FORMS = new Set(['pt', 'cv', 'tbk', 'ud', 'pd', 'persero', 'fa']);
// Words too common to suggest two names belong together on their own
// ("Toko A" vs "Toko B"). Names still match exactly with them.
const COMMON_WORDS = new Set([
  'toko', 'tk', 'bpk', 'bapak', 'pak', 'ibu', 'bu', 'warung', 'kantin', 'cafe', 'kafe', 'resto',
  'restoran', 'rumah', 'makan', 'rm', 'apotek', 'klinik', 'jaya', 'abadi', 'makmur', 'sejahtera',
  'indonesia', 'batam', 'mandiri', 'sentosa', 'the', 'and', 'dan',
]);

// Below this, two names only count as similar when they share a word that
// isn't common. 0.75 catches typos ("Indoneisa") without pairing unrelated
// names.
const SIMILAR_NAME_SCORE = 0.75;
const MAX_MATCHES = 5;

function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

export function nameKey(name: string): string {
  return words(name)
    .filter((w) => !LEGAL_FORMS.has(w))
    .sort()
    .join(' ');
}

export function addressKey(address?: string | null): string {
  return words(address ?? '').join(' ');
}

// 0812…, +62 812…, 62812… all read as the same number; anything shorter
// than a real phone number never matches.
export function phoneKey(phone?: string | null): string {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('62')) digits = `0${digits.slice(2)}`;
  return digits.length >= 8 ? digits : '';
}

export function npwpKey(npwp?: string | null): string {
  return (npwp ?? '').replace(/\D/g, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

// Dice coefficient over character pairs: 1 = same, 0 = nothing shared.
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const g of a) if (b.has(g)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function distinctiveWords(key: string): string[] {
  return key.split(' ').filter((w) => w.length >= 3 && !COMMON_WORDS.has(w));
}

type Entry = Existing & { nameKey: string; addressKey: string; grams: Set<string> };

export class CustomerDuplicateIndex {
  private readonly byName = new Map<string, Entry[]>();
  private readonly byWord = new Map<string, Entry[]>();
  private readonly byPhone = new Map<string, Entry[]>();
  private readonly byNpwp = new Map<string, Entry[]>();

  constructor(customers: Existing[]) {
    for (const c of customers) this.add(c);
  }

  add(c: Existing) {
    const key = nameKey(c.name);
    const entry: Entry = { ...c, nameKey: key, addressKey: addressKey(c.address), grams: bigrams(key) };
    push(this.byName, key, entry);
    for (const w of new Set(distinctiveWords(key))) push(this.byWord, w, entry);
    const phone = phoneKey(c.phone);
    if (phone) push(this.byPhone, phone, entry);
    const npwp = npwpKey(c.npwp);
    if (npwp) push(this.byNpwp, npwp, entry);
  }

  check(input: DuplicateCandidate, excludeId?: string): DuplicateCheck {
    const key = nameKey(input.name);
    const address = addressKey(input.address);
    const grams = bigrams(key);
    const exact = new Map<string, DuplicateMatch>();
    const similar = new Map<string, DuplicateMatch & { score: number }>();
    const match = (e: Entry, reason: DuplicateReason): DuplicateMatch => ({
      id: e.id,
      name: e.name,
      address: e.address,
      phone: e.phone,
      reason,
    });
    const addSimilar = (e: Entry, reason: DuplicateReason, score: number) => {
      if (e.id === excludeId || exact.has(e.id)) return;
      const prev = similar.get(e.id);
      if (!prev || prev.score < score) similar.set(e.id, { ...match(e, reason), score });
    };

    const npwp = npwpKey(input.npwp);
    for (const e of npwp ? (this.byNpwp.get(npwp) ?? []) : []) {
      if (e.id !== excludeId) exact.set(e.id, match(e, 'SAME_NPWP'));
    }
    if (key) {
      for (const e of this.byName.get(key) ?? []) {
        if (e.id === excludeId || exact.has(e.id)) continue;
        if (e.addressKey === address) exact.set(e.id, match(e, 'SAME_NAME_ADDRESS'));
        else addSimilar(e, 'SAME_NAME', 1);
      }
      const seen = new Set<string>();
      for (const w of distinctiveWords(key)) {
        for (const e of this.byWord.get(w) ?? []) {
          if (seen.has(e.id) || e.nameKey === key) continue;
          seen.add(e.id);
          const score = similarity(grams, e.grams);
          if (score >= SIMILAR_NAME_SCORE) addSimilar(e, 'SIMILAR_NAME', score);
        }
      }
    }
    const phone = phoneKey(input.phone);
    for (const e of phone ? (this.byPhone.get(phone) ?? []) : []) addSimilar(e, 'SAME_PHONE', 0.5);

    return {
      exact: [...exact.values()].slice(0, MAX_MATCHES),
      similar: [...similar.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_MATCHES)
        .map(({ score: _score, ...m }) => m),
    };
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
