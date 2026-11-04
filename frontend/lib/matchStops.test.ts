import { describe, expect, it } from 'vitest';
import { matchStops, type SearchableStop } from './matchStops';

const stop = (sequence: number, label: string, extra: Partial<SearchableStop> = {}): SearchableStop => ({
  sequence,
  status: 'PENDING',
  label,
  customerName: label,
  doNumber: null,
  address: null,
  addressLabel: null,
  ...extra,
});

const labels = (stops: SearchableStop[]) => stops.map((s) => s.label);

describe('matchStops', () => {
  const stops = [
    stop(1, 'Toko Maju', { address: 'Jl. Sudirman 12' }),
    stop(2, 'Bengkel Jaya', { doNumber: 'DO-0042', status: 'DELIVERED' }),
    stop(12, 'Toko Sentosa', { address: 'Nagoya Hill', addressLabel: 'Gudang Timur' }),
  ];

  it('lists nothing until something is typed', () => {
    expect(matchStops(stops, '')).toEqual([]);
    expect(matchStops(stops, '   ')).toEqual([]);
  });

  it('finds a stop by name, address, saved-address name or DO number, ignoring case', () => {
    expect(labels(matchStops(stops, 'bengkel'))).toEqual(['Bengkel Jaya']);
    expect(labels(matchStops(stops, 'NAGOYA'))).toEqual(['Toko Sentosa']);
    expect(labels(matchStops(stops, 'gudang'))).toEqual(['Toko Sentosa']);
    expect(labels(matchStops(stops, 'do-0042'))).toEqual(['Bengkel Jaya']);
  });

  it('needs every word, in any order', () => {
    expect(labels(matchStops(stops, 'sentosa toko'))).toEqual(['Toko Sentosa']);
    expect(matchStops(stops, 'toko bengkel')).toEqual([]);
  });

  it('puts the stop at that position first when a number is typed', () => {
    expect(labels(matchStops(stops, '12'))).toEqual(['Toko Sentosa', 'Toko Maju']);
  });

  it('forgives typos, including while the word is still being typed', () => {
    expect(labels(matchStops(stops, 'bengkle'))).toEqual(['Bengkel Jaya']);
    expect(labels(matchStops(stops, 'sentsoa'))).toEqual(['Toko Sentosa']);
    expect(labels(matchStops(stops, 'sudirmn'))).toEqual(['Toko Maju']);
    expect(labels(matchStops(stops, 'sentso'))).toEqual(['Toko Sentosa']);
    expect(labels(matchStops(stops, 'tiko sentosa'))).toEqual(['Toko Sentosa']);
  });

  it('ignores spacing and punctuation', () => {
    expect(labels(matchStops(stops, 'tokomaju'))).toEqual(['Toko Maju']);
    expect(labels(matchStops(stops, 'do0042'))).toEqual(['Bengkel Jaya']);
    expect(labels(matchStops(stops, 'jl sudirman, 12'))).toEqual(['Toko Maju']);
  });

  it('never guesses at numbers or short words', () => {
    expect(matchStops(stops, 'do-0043')).toEqual([]);
    expect(matchStops(stops, 'tik')).toEqual([]);
  });

  it('only reaches for typos when nothing matches as typed', () => {
    const raya = [stop(1, 'Bengkel Jaya'), stop(2, 'Toko B', { address: 'Jl. Raya Batam' })];
    expect(labels(matchStops(raya, 'jaya'))).toEqual(['Bengkel Jaya']);
    expect(labels(matchStops(raya, 'rayya'))).toEqual(['Toko B']);
  });

  it('puts stops still to be done before finished ones', () => {
    const mixed = [stop(1, 'Toko A', { status: 'FAILED' }), stop(2, 'Toko B')];
    expect(labels(matchStops(mixed, 'toko'))).toEqual(['Toko B', 'Toko A']);
  });
});
