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
