import { CustomerDuplicateIndex, identityKey, nameKey, phoneKey } from './customer-duplicates';

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

  // Branches of one company share its NPWP since Coretax, so a repeat is
  // asked about, not refused.
  it('calls the same NPWP similar, whatever the name', () => {
    const r = index.check({ name: 'Other name', npwp: '012345678901000' });
    expect(r.exact).toEqual([]);
    expect(r.similar[0]).toMatchObject({ id: 'npwp', reason: 'SAME_NPWP' });
  });

  it('reads the 15- and 16-digit forms of an NPWP as one number', () => {
    expect(index.check({ name: 'Other name', npwp: '0012345678901000' }).similar[0]).toMatchObject({ id: 'npwp' });
  });

  it('never matches on an all-zero NPWP', () => {
    const zeros = new CustomerDuplicateIndex([c('z', 'Walk-in', null, null, '00.000.000.0-000.000')]);
    expect(zeros.check({ name: 'Somebody else', npwp: '000000000000000' })).toEqual({ exact: [], similar: [] });
  });

  describe('with no address on either', () => {
    const people = new CustomerDuplicateIndex([c('budi', 'Budi', null, '0812-1111-1111')]);

    it('calls the same name with another phone similar — two people can share a name', () => {
      const r = people.check({ name: 'Budi', phone: '0813-2222-2222' });
      expect(r.exact).toEqual([]);
      expect(r.similar[0]).toMatchObject({ id: 'budi', reason: 'SAME_NAME' });
    });

    it('calls the same name and phone an exact copy', () => {
      expect(people.check({ name: 'budi', phone: '+62 812 1111 1111' }).exact[0]).toMatchObject({ id: 'budi' });
    });
  });

  it('tells names apart that have no latin letters', () => {
    const cjk = new CustomerDuplicateIndex([c('zhang', '张三')]);
    expect(cjk.check({ name: '李四' })).toEqual({ exact: [], similar: [] });
    expect(cjk.check({ name: '张三' }).similar[0]).toMatchObject({ id: 'zhang', reason: 'SAME_NAME' });
    expect(identityKey({ name: '张三' })).not.toBe(identityKey({ name: '李四' }));
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
