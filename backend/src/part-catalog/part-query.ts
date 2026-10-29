// Reads a workshop's free-text parts search the way a mechanic types it: "AVANZA 2006 WHEEL HUB",
// "whell hub avanza" (typo), "grand new avanza laher roda", a kode rangka (F651) / kode mesin (1NR-VE),
// a whole nomor rangka or nomor mesin from the STNK, or an OEM number. Codes needn't be typed in full:
// "NCP15", "L15", "ZRE" match every code starting so, and "ZRE 142" / "2KD FTV" read as one code. The words it knows come from
// PartSearchTerm (written by the scraper's sync).

export type SearchTerm = {
  kind: string; // brand | model | generation | chassis | engine | item
  carBrand: string;
  model: string;
  generation: string;
  itemType: string;
  item: string;
  term: string;
  termNormalized: string;
};

export type VehicleFilter = {
  carBrand: string;
  model?: string;
  generations?: string[];
};

export type ParsedQuery = {
  vehicles: VehicleFilter[]; // any of these; empty = no car named
  year?: number;
  items: { itemType: string; item: string }[]; // any of these
  oems: string[]; // normalized
  partBrands: string[];
  codes: { kind: 'chassis' | 'engine'; typed: string; code: string }[];
  specs: string[]; // as the catalogue writes them: H4, NS60, 10W-40, 14"
  corrections: { typed: string; as: string }[]; // typos read as a known word
  ignored: string[];
  recognized: boolean;
};

const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

// A spec compared the way people type it: "10w40" = 10W-40, "14inch" / 14in = 14", "215/55 r17" = 215/55 R17.
export const specKey = (v: string) =>
  normalize(v.toUpperCase().replace(/(\d)\s*(?:"|''|INCH|IN)$/, '$1IN'));

// Engine family a nomor mesin starts with: "1NR-VE" → 1NR, "K3-VE" → K3, "4A91" → 4A91, "L15Z5" → L15Z5.
const engineFamily = (code: string) => normalize(code.split('-')[0]);

// Edit distance with adjacent swaps ("whele" → "wheel"), stopping early once past `max`.
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

// Typos allowed per word: none for short words or anything with digits (codes, years), else 1, or 2 from 8 letters.
const allowedTypos = (w: string) =>
  /\d/.test(w) || w.length <= 3 ? 0 : w.length >= 8 ? 2 : 1;

const MAX_WORD_ITEMS = 6;
// A partial code fitting more generations than this ("K1" across brands) is too vague to filter by.
const MAX_CODE_GENERATIONS = 24;
// How many of a partial code's matches to name in the "read as" chip.
const SHOWN_CODES = 4;

type CodeHit = {
  kind: 'chassis' | 'engine';
  code: string;
  terms: SearchTerm[];
};

type Phrase = { words: string[]; compact: string; term: SearchTerm };

// Words that say where or which (front, left, original…) — data has no such column, so they narrow nothing.
export const NOISE_WORDS = new Set(
  'depan belakang kiri kanan atas bawah dalam luar fr rr lh rh front rear left right upper lower inner outer set pasang satu 1set mobil untuk utk buat for ori original asli genuine oem kw murah harga baru new assy komplit lengkap'.split(
    ' ',
  ),
);

export class PartQueryParser {
  private phrases: Phrase[] = [];
  private phraseWords = new Set<string>(); // every word of a car, item or brand name
  private carWords = new Set<string>(); // every word of a car brand, model or generation name
  private specs = new Map<string, string[]>(); // specKey → the spec values written so
  private chassis = new Map<string, SearchTerm[]>(); // normalized code → generations
  private engines = new Map<string, SearchTerm[]>(); // normalized code and family → generations
  readonly codesByVehicle = new Map<
    string,
    { chassis: string[]; engine: string[] }
  >();

  constructor(
    terms: SearchTerm[],
    private readonly partBrands: string[] = [],
    specs: string[] = [],
  ) {
    // Combined specs ("46B24L / NS60L", wiper pairs "24\" + 14\"") are looked up by each part.
    for (const spec of specs)
      for (const part of spec.split(/ \/ | \+ /)) {
        const key = specKey(part.trim());
        if (key.length < 2 || !/[A-Z]/.test(key)) continue;
        const known = this.specs.get(key) ?? [];
        if (!known.includes(part.trim()))
          this.specs.set(key, [...known, part.trim()]);
      }
    const add = (m: Map<string, SearchTerm[]>, k: string, t: SearchTerm) =>
      m.set(k, [...(m.get(k) ?? []), t]);
    for (const t of terms) {
      if (t.kind === 'chassis' || t.kind === 'engine') {
        const key = `${t.carBrand}|${t.model}|${t.generation}`;
        const codes = this.codesByVehicle.get(key) ?? {
          chassis: [],
          engine: [],
        };
        const shown = t.kind === 'chassis' ? t.term.toUpperCase() : t.term;
        if (!codes[t.kind].includes(shown)) codes[t.kind].push(shown);
        this.codesByVehicle.set(key, codes);
        if (t.kind === 'chassis') add(this.chassis, t.termNormalized, t);
        else {
          add(this.engines, t.termNormalized, t);
          if (engineFamily(t.term) !== t.termNormalized)
            add(this.engines, engineFamily(t.term), t);
        }
      }
      if (['brand', 'model', 'generation', 'item'].includes(t.kind)) {
        const words = t.term
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter(Boolean);
        if (words.length)
          this.phrases.push({ words, compact: words.join(''), term: t });
        for (const w of words) {
          this.phraseWords.add(w);
          if (t.kind !== 'item') this.carWords.add(w);
        }
      }
    }
  }

  parse(q: string, knownOems: Set<string> = new Set()): ParsedQuery {
    const raw = q.split(/[\s,;]+/).filter(Boolean);
    const tokens = raw.map((w) => w.toLowerCase());
    const used = tokens.map(() => false);
    const out: ParsedQuery = {
      vehicles: [],
      items: [],
      oems: [],
      partBrands: [],
      codes: [],
      specs: [],
      corrections: [],
      ignored: [],
      recognized: false,
    };
    const codeHits: SearchTerm[][] = [];
    const phraseHits: SearchTerm[] = [];

    const takeCode = (hit: CodeHit, from: number, to = from) => {
      codeHits.push(hit.terms);
      out.codes.push({
        kind: hit.kind,
        typed: raw.slice(from, to + 1).join(' '),
        code: hit.code,
      });
      for (let k = from; k <= to; k++) used[k] = true;
    };

    for (let i = 0; i < tokens.length; i++) {
      const n = normalize(tokens[i]);
      const next = i + 1 < tokens.length ? tokens[i + 1] : null;
      const joined = next ? this.exactCode(n + normalize(next)) : null;
      const joinedSpec = next
        ? this.specs.get(specKey(`${tokens[i]} ${next}`))
        : undefined;
      // A car's own word stays the car's: "H1" is Hyundai's model before it is a bulb.
      const spec = this.carWords.has(tokens[i])
        ? undefined
        : this.specs.get(specKey(tokens[i]));
      if (/^(19[5-9]\d|20[0-4]\d)$/.test(n) && out.year === undefined) {
        out.year = Number(n);
        used[i] = true;
      } else if (n.length >= 5 && /\d/.test(n) && knownOems.has(n)) {
        out.oems.push(n);
        used[i] = true;
      } else if (joined) {
        // A code typed with a space: "ZRE 142", "2KD FTV"
        takeCode(joined, i, ++i);
      } else if (this.exactCode(n)) {
        // A bare code: "F651", "1NR", "K3-VE"
        takeCode(this.exactCode(n)!, i);
      } else if (joinedSpec) {
        // A spec typed in two: "215/55 R17", "10W 40"
        out.specs.push(...joinedSpec);
        used[i] = used[++i] = true;
      } else if (spec) {
        // A spec: "H4", "NS60", "10w40", "14inch"
        out.specs.push(...spec);
        used[i] = true;
      } else if (
        n.length >= 7 &&
        /\d/.test(n) &&
        /[A-Z]/.test(n) &&
        this.serialNumber(n)
      ) {
        takeCode(this.serialNumber(n)!, i);
      } else if (/\d/.test(n) && /[A-Z]/.test(n) && this.codePrefix(n)) {
        // The start of a code: "NCP15", "L15", "G4K"
        takeCode(this.codePrefix(n)!, i);
      }
    }

    // Words and phrases, longest first, so "wheel hub" wins over "wheel" and "pajero sport" over "pajero".
    for (let len = Math.min(4, tokens.length); len >= 1; len--) {
      for (let start = 0; start + len <= tokens.length; start++) {
        if (used.slice(start, start + len).some(Boolean)) continue;
        const words = tokens
          .slice(start, start + len)
          .map((w) => w.replace(/[^a-z0-9]/g, ''))
          .filter(Boolean);
        if (!words.length) continue;
        const match = this.matchPhrase(words);
        if (!match) continue;
        for (let k = start; k < start + len; k++) used[k] = true;
        phraseHits.push(...match.terms);
        if (match.typo)
          out.corrections.push({
            typed: raw.slice(start, start + len).join(' '),
            as: match.typo,
          });
      }
    }

    // The start or middle of an item's name: "lampu rem" → Third Brake Lamp ("lampu rem atas").
    for (let len = Math.min(3, tokens.length); len >= 2; len--) {
      for (let start = 0; start + len <= tokens.length; start++) {
        if (used.slice(start, start + len).some(Boolean)) continue;
        const words = tokens.slice(start, start + len);
        if (words.some((w) => !/^[a-z]+$/.test(w) || NOISE_WORDS.has(w)))
          continue;
        const items = new Map<string, SearchTerm>();
        for (const p of this.phrases)
          if (
            p.term.kind === 'item' &&
            p.words.length > len &&
            p.words.some((_, k) => words.every((w, j) => p.words[k + j] === w))
          )
            items.set(p.term.item, p.term);
        if (items.size === 0 || items.size > MAX_WORD_ITEMS) continue;
        phraseHits.push(...items.values());
        for (let k = start; k < start + len; k++) used[k] = true;
      }
    }

    // A lone word that is part of item names: "shock" → Shock Absorber / Shock Bearing / Shock Mounting.
    // Too common a word ("rem", "bearing" fit dozens of items) stays unmatched, and so does a car's word
    // ("colt" of Colt Diesel is no typo of "bolt").
    tokens.forEach((tok, i) => {
      if (used[i] || !/^[a-z]{4,}$/.test(tok) || this.carWords.has(tok)) return;
      const max = allowedTypos(tok);
      const items = new Map<string, SearchTerm>();
      for (const p of this.phrases)
        if (
          p.term.kind === 'item' &&
          p.words.length > 1 &&
          p.words.some(
            (w) => w === tok || (max && editDistance(tok, w, max) <= max),
          )
        )
          items.set(p.term.item, p.term);
      if (items.size === 0 || items.size > MAX_WORD_ITEMS) return;
      phraseHits.push(...items.values());
      used[i] = true;
    });

    tokens.forEach((tok, i) => {
      if (used[i]) return;
      const brand = this.partBrands.find((b) => b.toLowerCase() === tok);
      // Letters alone ("ZRE", "GUN") are only a code when the word isn't in any car, item or part brand name.
      const code =
        brand || !/^[a-z]{3,}$/.test(tok) || this.phraseWords.has(tok)
          ? null
          : this.codePrefix(normalize(tok));
      // A bare size left over ("wiper xpander 24") is inches, when the catalogue has that size.
      const inches = /^\d{2}$/.test(tok)
        ? this.specs.get(`${tok}IN`)
        : undefined;
      if (brand) out.partBrands.push(brand);
      else if (code) takeCode(code, i);
      else if (inches) out.specs.push(...inches);
      else out.ignored.push(raw[i]);
    });

    out.specs = [...new Set(out.specs)];
    const uniq = <T>(xs: T[], key: (x: T) => string) => [
      ...new Map(xs.map((x) => [key(x), x])).values(),
    ];
    out.items = uniq(
      phraseHits
        .filter((t) => t.kind === 'item')
        .map((t) => ({ itemType: t.itemType, item: t.item })),
      (x) => x.item,
    );
    out.vehicles = this.vehicles(phraseHits, codeHits);
    out.recognized = !!(
      out.vehicles.length ||
      out.items.length ||
      out.oems.length ||
      out.codes.length ||
      out.specs.length ||
      out.partBrands.length ||
      out.year
    );
    return out;
  }

  // A code typed in full. An engine family ("1NR" of 1NR-VE) counts only when too short for codePrefix
  // ("K3"), so a longer one ("L15") gathers every code starting so, not just those it's the family of.
  private exactCode(n: string): CodeHit | null {
    const chassis = this.chassis.get(n) ?? [];
    const engines = (this.engines.get(n) ?? []).filter(
      (t) => n.length < 3 || t.termNormalized === n,
    );
    if (!chassis.length && !engines.length) return null;
    const terms = [...chassis, ...engines];
    return {
      kind: chassis.length ? 'chassis' : 'engine',
      code: terms[0].term.toUpperCase(),
      terms,
    };
  }

  // Every chassis and engine code starting with `n` (3+ characters), unless that's too many cars to mean one.
  private codePrefix(n: string): CodeHit | null {
    if (n.length < 3) return null;
    const terms: SearchTerm[] = [];
    const codes = new Set<string>();
    let chassisKeys = 0;
    let engineKeys = 0;
    for (const [kind, map] of [
      ['chassis', this.chassis],
      ['engine', this.engines],
    ] as const)
      for (const [key, ts] of map) {
        if (!key.startsWith(n)) continue;
        if (kind === 'chassis') chassisKeys++;
        else engineKeys++;
        for (const t of ts) {
          terms.push(t);
          codes.add(t.term.toUpperCase());
        }
      }
    if (!terms.length) return null;
    const gens = new Set(
      terms.map((t) => `${t.carBrand}|${t.model}|${t.generation}`),
    );
    if (gens.size > MAX_CODE_GENERATIONS) return null;
    const shown = [...codes].sort();
    return {
      kind: chassisKeys >= engineKeys ? 'chassis' : 'engine',
      code:
        shown.slice(0, SHOWN_CODES).join(' / ') +
        (shown.length > SHOWN_CODES ? ` +${shown.length - SHOWN_CODES}` : ''),
      terms,
    };
  }

  // A whole nomor mesin ("1NRF123456": starts with the engine family) or nomor rangka (a frame number
  // starting with the chassis code, "ZRE1201234567", or a VIN carrying it, "MHYKZE81S..."). Longest code wins.
  private serialNumber(n: string): CodeHit | null {
    let best: {
      kind: 'chassis' | 'engine';
      key: string;
      terms: SearchTerm[];
    } | null = null;
    const consider = (
      kind: 'chassis' | 'engine',
      key: string,
      terms: SearchTerm[],
    ) => {
      if (!best || key.length > best.key.length) best = { kind, key, terms };
    };
    const vin = n.length === 17;
    if (!vin)
      for (const [key, terms] of this.engines)
        if (key.length >= 2 && n.startsWith(key) && n.length > key.length)
          consider('engine', key, terms);
    for (const [key, terms] of this.chassis) {
      if (key.length < 3) continue;
      if (
        n.startsWith(key) ||
        (vin && key.length >= 4 && n.slice(3, 11).includes(key))
      )
        consider('chassis', key, terms);
    }
    if (!best) return null;
    const found = best as {
      kind: 'chassis' | 'engine';
      key: string;
      terms: SearchTerm[];
    };
    return {
      kind: found.kind,
      code: found.terms[0].term.toUpperCase(),
      terms: found.terms,
    };
  }

  private matchPhrase(
    words: string[],
  ): { terms: SearchTerm[]; typo?: string } | null {
    const compact = words.join('');
    const exact = this.phrases.filter((p) => p.compact === compact);
    if (exact.length) return { terms: exact.map((p) => p.term) };
    let bestCost = Infinity;
    let best: Phrase[] = [];
    for (const p of this.phrases) {
      if (p.words.length !== words.length) continue;
      let cost = 0;
      for (let i = 0; i < words.length && cost < Infinity; i++) {
        const max = allowedTypos(p.words[i]);
        const d =
          words[i] === p.words[i]
            ? 0
            : max
              ? editDistance(words[i], p.words[i], max)
              : 1;
        cost = d > max ? Infinity : cost + d;
      }
      if (cost < bestCost) [bestCost, best] = [cost, [p]];
      else if (cost === bestCost && cost < Infinity) best.push(p);
    }
    if (!best.length || bestCost === Infinity) return null;
    return { terms: best.map((p) => p.term), typo: best[0].words.join(' ') };
  }

  // Cars named: generations from codes / generation words (all codes typed must agree), narrowed by any
  // model or brand typed; otherwise the models typed; otherwise just the brand.
  private vehicles(
    phraseHits: SearchTerm[],
    codeHits: SearchTerm[][],
  ): VehicleFilter[] {
    const genKey = (t: SearchTerm) =>
      `${t.carBrand}|${t.model}|${t.generation}`;
    const groups = [
      ...codeHits,
      ...phraseHits.filter((t) => t.kind === 'generation').map((t) => [t]),
    ];
    let gens: SearchTerm[] = [];
    for (const g of groups) {
      if (!gens.length) gens = g;
      else {
        const keys = new Set(g.map(genKey));
        const both = gens.filter((t) => keys.has(genKey(t)));
        gens = both.length ? both : gens; // conflicting codes: keep the first one typed
      }
    }
    const models = phraseHits.filter((t) => t.kind === 'model');
    const brands = new Set(
      phraseHits.filter((t) => t.kind === 'brand').map((t) => t.carBrand),
    );
    const modelKeys = new Set(models.map((t) => `${t.carBrand}|${t.model}`));
    if (gens.length) {
      const narrowed = gens.filter(
        (t) =>
          (!modelKeys.size || modelKeys.has(`${t.carBrand}|${t.model}`)) &&
          (!brands.size || brands.has(t.carBrand)),
      );
      const list = narrowed.length ? narrowed : gens;
      const byModel = new Map<string, VehicleFilter>();
      for (const t of list) {
        const v = byModel.get(`${t.carBrand}|${t.model}`) ?? {
          carBrand: t.carBrand,
          model: t.model,
          generations: [],
        };
        if (!v.generations!.includes(t.generation))
          v.generations!.push(t.generation);
        byModel.set(`${t.carBrand}|${t.model}`, v);
      }
      return [...byModel.values()];
    }
    if (models.length) {
      const list = models.filter((t) => !brands.size || brands.has(t.carBrand));
      return [
        ...new Map(
          (list.length ? list : models).map((t) => [
            `${t.carBrand}|${t.model}`,
            { carBrand: t.carBrand, model: t.model },
          ]),
        ).values(),
      ];
    }
    return [...brands].map((carBrand) => ({ carBrand }));
  }
}
