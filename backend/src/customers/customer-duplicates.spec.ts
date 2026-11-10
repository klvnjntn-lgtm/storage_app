import { CustomerDuplicateIndex, nameKey, phoneKey } from './customer-duplicates';

const c = (id: string, name: string, address: string | null = null, phone: string | null = null, npwp: string | null = null) => ({
  id,
  name,
  address,
  phone,
  npwp,
});

describe('customer duplicates', () => {
  const index = new CustomerDuplicateIndex([
    c('bumi', 'Bumi Indoneisa, PT', 'Kawasan Sarana Blok B No. 3', '0812-3456-7890'),
    c('lb05', 'LB Technologies Batam PT PT ( KANTIN B 05 )', 'Kawasan Sarana Blok B No 05'),
    c('lb08', 'LB Technologies Batam PT PT ( KANTIN B 08 & 09 )', 'Kawasan Sarana Blok B No 08'),
    c('abadi', 'Toko Abadi', 'Jl. Merdeka 1'),
    c('npwp', 'Sinar Jaya', 'Jl. Sudirman 9', null, '01.234.567.8-901.000'),
  ]);

  it('reads names without case, punctuation, word order or legal form', () => {
    expect(nameKey('Bumi Indoneisa, PT')).toBe(nameKey('PT bumi  indoneisa'));
    expect(phoneKey('+62 812 3456 7890')).toBe(phoneKey('0812-3456-7890'));
  });

  it('calls the same name at the same address an exact copy', () => {
    const r = index.check({ name: 'PT Bumi Indoneisa', address: 'kawasan sarana blok b no 3' });
    expect(r.exact.map((m) => [m.id, m.reason])).toEqual([['bumi', 'SAME_NAME_ADDRESS']]);
  });

  it('calls the same NPWP an exact copy, whatever the name', () => {
    expect(index.check({ name: 'Other name', npwp: '012345678901000' }).exact[0]).toMatchObject({
      id: 'npwp',
      reason: 'SAME_NPWP',
    });
  });

  it('calls the same name at another address similar, not a copy', () => {
    const r = index.check({ name: 'Bumi Indoneisa PT', address: 'Batam Centre' });
    expect(r.exact).toEqual([]);
    expect(r.similar[0]).toMatchObject({ id: 'bumi', reason: 'SAME_NAME' });
  });

  it('catches a typo in the name', () => {
    expect(index.check({ name: 'PT Bumi Indonesia' }).similar[0]).toMatchObject({ id: 'bumi', reason: 'SIMILAR_NAME' });
  });

  it('lists branches of one business as similar', () => {
    const r = index.check({ name: 'LB Technologies Batam PT (KANTIN B 10)', address: 'Kawasan Sarana Blok B No 10' });
    expect(r.exact).toEqual([]);
    expect(r.similar.map((m) => m.id).sort()).toEqual(['lb05', 'lb08']);
  });

  it('flags the same phone number', () => {
    expect(index.check({ name: 'Somebody else', phone: '+62 812 3456 7890' }).similar[0]).toMatchObject({
      id: 'bumi',
      reason: 'SAME_PHONE',
    });
  });

  it('does not pair names that only share a common word', () => {
    expect(index.check({ name: 'Toko Budi' })).toEqual({ exact: [], similar: [] });
  });

  it('leaves the customer being edited out', () => {
    expect(index.check({ name: 'Toko Abadi', address: 'Jl. Merdeka 1' }, 'abadi')).toEqual({ exact: [], similar: [] });
  });
});
