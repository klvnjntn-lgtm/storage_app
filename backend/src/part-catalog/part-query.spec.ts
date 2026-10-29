import { PartQueryParser, SearchTerm, editDistance } from './part-query';

const term = (
  kind: string,
  term: string,
  v: Partial<SearchTerm> = {},
): SearchTerm => ({
  kind,
  carBrand: '',
  model: '',
  generation: '',
  itemType: '',
  item: '',
  term,
  termNormalized: term.toUpperCase().replace(/[^A-Z0-9]/g, ''),
  ...v,
});
const avanza1 = {
  carBrand: 'Toyota',
  model: 'Avanza',
  generation: 'Gen 1 (F600)',
};
const avanza2 = {
  carBrand: 'Toyota',
  model: 'Avanza',
  generation: 'Gen 2 (F650)',
};
const ertiga = {
  carBrand: 'Suzuki',
  model: 'Ertiga',
  generation: 'Gen 1 (ZE)',
};
const hub = { itemType: 'Wheels & Bearings', item: 'Hub Bearing' };
const wheel = { itemType: 'Wheels & Bearings', item: 'Wheel Bearing' };

const parser = new PartQueryParser(
  [
    term('brand', 'Toyota', { carBrand: 'Toyota' }),
    term('model', 'avanza', { carBrand: 'Toyota', model: 'Avanza' }),
    term('model', 'pajero', { carBrand: 'Mitsubishi', model: 'Pajero Sport' }),
    term('model', 'pajero sport', {
      carBrand: 'Mitsubishi',
      model: 'Pajero Sport',
    }),
    term('generation', 'grand new avanza', avanza2),
    term('chassis', 'f601', avanza1),
    term('chassis', 'f651', avanza2),
    term('chassis', 'ze81', ertiga),
    term('engine', 'K3-VE', avanza1),
    term('engine', 'K3-VE', avanza2),
    term('engine', '3SZ-VE', avanza1),
    term('engine', '1NR-VE', avanza2),
    term('item', 'hub bearing', hub),
    term('item', 'wheel hub', hub),
    term('item', 'laher roda', wheel),
    term('item', 'wheel bearing', wheel),
  ],
  ['Aspira'],
);

describe('PartQueryParser', () => {
  it('reads car, year and item the way a workshop types them', () => {
    const p = parser.parse('AVANZA 2006 WHEEL HUB');
    expect(p.vehicles).toEqual([{ carBrand: 'Toyota', model: 'Avanza' }]);
    expect(p.year).toBe(2006);
    expect(p.items).toEqual([hub]);
    expect(p.ignored).toEqual([]);
  });

  it('forgives typos and says how it read them', () => {
    const p = parser.parse('WHELL HUB avnza');
    expect(p.items).toEqual([hub]);
    expect(p.vehicles).toEqual([{ carBrand: 'Toyota', model: 'Avanza' }]);
    expect(p.corrections).toEqual(
      expect.arrayContaining([
        { typed: 'WHELL HUB', as: 'wheel hub' },
        { typed: 'avnza', as: 'avanza' },
      ]),
    );
  });

  it('prefers the longer name: pajero sport, grand new avanza', () => {
    expect(parser.parse('pajero sport').vehicles).toEqual([
      { carBrand: 'Mitsubishi', model: 'Pajero Sport' },
    ]);
    expect(parser.parse('grand new avanza laher roda')).toMatchObject({
      vehicles: [
        { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 2 (F650)'] },
      ],
      items: [wheel],
    });
  });

  it('finds the generation from a kode rangka or kode mesin', () => {
    expect(parser.parse('F651').vehicles).toEqual([
      { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 2 (F650)'] },
    ]);
    expect(parser.parse('3SZ-VE').vehicles).toEqual([
      { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 1 (F600)'] },
    ]);
    // K3-VE was in both; the chassis code narrows it.
    expect(parser.parse('K3 F601').vehicles).toEqual([
      { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 1 (F600)'] },
    ]);
  });

  it('reads a code typed only in part, or with a space', () => {
    const partial = parser.parse('F65 laher roda');
    expect(partial.codes).toEqual([
      { kind: 'chassis', typed: 'F65', code: 'F651' },
    ]);
    expect(partial.vehicles).toEqual([
      { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 2 (F650)'] },
    ]);
    expect(partial.items).toEqual([wheel]);
    expect(parser.parse('3SZ VE').codes).toEqual([
      { kind: 'engine', typed: '3SZ VE', code: '3SZ-VE' },
    ]);
    // "F6" is too short to mean a code.
    expect(parser.parse('F6').recognized).toBe(false);
  });

  it('reads a whole nomor mesin and nomor rangka from the STNK', () => {
    const engine = parser.parse('1NRF123456 laher roda');
    expect(engine.codes).toEqual([
      { kind: 'engine', typed: '1NRF123456', code: '1NR-VE' },
    ]);
    expect(engine.vehicles).toEqual([
      { carBrand: 'Toyota', model: 'Avanza', generations: ['Gen 2 (F650)'] },
    ]);
    const vin = parser.parse('MHYKZE81S9J123456');
    expect(vin.codes).toEqual([
      { kind: 'chassis', typed: 'MHYKZE81S9J123456', code: 'ZE81' },
    ]);
    expect(vin.vehicles).toEqual([
      { carBrand: 'Suzuki', model: 'Ertiga', generations: ['Gen 1 (ZE)'] },
    ]);
    expect(parser.parse('F601RV-0123456').vehicles[0].generations).toEqual([
      'Gen 1 (F600)',
    ]);
  });

  it('keeps OEM numbers and part brands, and reports words it did not understand', () => {
    const p = parser.parse('43502-BZ010 aspira kiri', new Set(['43502BZ010']));
    expect(p.oems).toEqual(['43502BZ010']);
    expect(p.partBrands).toEqual(['Aspira']);
    expect(p.ignored).toEqual(['kiri']);
  });

  it('recognizes nothing in plain unknown text', () => {
    expect(parser.parse('xyzzy').recognized).toBe(false);
  });
});

describe('editDistance', () => {
  it('counts swaps as one edit', () => {
    expect(editDistance('whele', 'wheel')).toBe(1);
    expect(editDistance('whell', 'wheel')).toBe(1);
    expect(editDistance('avnza', 'avanza')).toBe(1);
  });
});

describe('PartQueryParser lone words', () => {
  const p = new PartQueryParser([
    term('model', 'avanza', { carBrand: 'Toyota', model: 'Avanza' }),
    term('item', 'shock absorber', {
      itemType: 'Suspension',
      item: 'Shock Absorber',
    }),
    term('item', 'shock bearing', {
      itemType: 'Suspension',
      item: 'Shock Bearing',
    }),
  ]);
  it('matches a word that is part of item names, typo included', () => {
    expect(p.parse('avanza shock').items.map((i) => i.item)).toEqual([
      'Shock Absorber',
      'Shock Bearing',
    ]);
    expect(p.parse('avanza shok').items.map((i) => i.item)).toEqual([
      'Shock Absorber',
      'Shock Bearing',
    ]);
  });
});

describe('PartQueryParser partial codes', () => {
  const altis = (generation: string) => ({
    carBrand: 'Toyota',
    model: 'Corolla Altis',
    generation,
  });
  const p = new PartQueryParser([
    term('model', 'altis', { carBrand: 'Toyota', model: 'Corolla Altis' }),
    term('item', 'rem cakram', { itemType: 'Brakes', item: 'Brake Disc' }),
    term('chassis', 'zre142', altis('Gen 10 (E140)')),
    term('chassis', 'zre172', altis('Gen 11 (E170)')),
    term('chassis', 'remx10', altis('Gen 9 (E120)')),
    term('engine', 'L15A', {
      carBrand: 'Honda',
      model: 'Jazz',
      generation: 'Gen 1 (GD)',
    }),
    term('engine', 'L15Z2', {
      carBrand: 'Honda',
      model: 'Jazz',
      generation: 'Gen 2 (GE)',
    }),
  ]);

  it('matches every code a start fits, naming them', () => {
    const r = p.parse('L15');
    expect(r.codes).toEqual([
      { kind: 'engine', typed: 'L15', code: 'L15A / L15Z2' },
    ]);
    expect(r.vehicles).toEqual([
      {
        carBrand: 'Honda',
        model: 'Jazz',
        generations: ['Gen 1 (GD)', 'Gen 2 (GE)'],
      },
    ]);
  });

  it('reads letters alone as a code only when no word claims them', () => {
    expect(p.parse('zre').vehicles).toEqual([
      {
        carBrand: 'Toyota',
        model: 'Corolla Altis',
        generations: ['Gen 10 (E140)', 'Gen 11 (E170)'],
      },
    ]);
    // "rem" is a word here (rem cakram), not the start of REMX10 — on its own too.
    const r = p.parse('rem cakram');
    expect(r.codes).toEqual([]);
    expect(r.items).toEqual([{ itemType: 'Brakes', item: 'Brake Disc' }]);
    expect(p.parse('rem').codes).toEqual([]);
    expect(p.parse('zre 142').codes).toEqual([
      { kind: 'chassis', typed: 'zre 142', code: 'ZRE142' },
    ]);
  });
});

describe('PartQueryParser specs and loose words', () => {
  const hyundai = { carBrand: 'Hyundai', model: 'H-1' };
  const p = new PartQueryParser(
    [
      term('model', 'avanza', { carBrand: 'Toyota', model: 'Avanza' }),
      term('model', 'h1', hyundai),
      term('model', 'colt diesel', {
        carBrand: 'Mitsubishi',
        model: 'Colt Diesel',
      }),
      term('item', 'bohlam', { itemType: 'Lamp', item: 'Headlamp Bulb' }),
      term('item', 'wiper', { itemType: 'Body', item: 'Wiper Blade' }),
      term('item', 'lampu rem atas', {
        itemType: 'Lamp',
        item: 'Third Brake Lamp',
      }),
      term('item', 'wheel bolt', {
        itemType: 'Wheels',
        item: 'Wheel Nut / Bolt',
      }),
    ],
    [],
    ['H4', 'H1', 'H11 / H4', '10W-40', '215/55 R17', '24" + 14"'],
  );

  it('reads specs however they are typed', () => {
    expect(p.parse('avanza bohlam h4').specs).toEqual(['H4']);
    expect(p.parse('oli 10w40').specs).toEqual(['10W-40']);
    expect(p.parse('10w 40').specs).toEqual(['10W-40']);
    expect(p.parse('ban 215/55 r17').specs).toEqual(['215/55 R17']);
    expect(p.parse('wiper 24inch').specs).toEqual(['24"']);
    expect(p.parse('wiper 14"').specs).toEqual(['14"']);
    // A bare size is inches only when that size exists.
    expect(p.parse('wiper 24').specs).toEqual(['24"']);
    expect(p.parse('wiper 30').specs).toEqual([]);
  });

  it("keeps a car's own words for the car", () => {
    const h1 = p.parse('h1');
    expect(h1.specs).toEqual([]);
    expect(h1.vehicles).toEqual([hyundai]);
    // "colt" is Colt Diesel's word, not a typo of "bolt".
    expect(p.parse('colt').items).toEqual([]);
  });

  it('matches the start of an item name', () => {
    expect(p.parse('lampu rem').items).toEqual([
      { itemType: 'Lamp', item: 'Third Brake Lamp' },
    ]);
  });
});
