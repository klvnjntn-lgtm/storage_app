import { mechanicNameFromItem, normalizePersonName } from './gdb-import.service';

jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

// The service items found in a real workshop's Accurate data (AUTOLINE).
describe('mechanics from Accurate service items', () => {
  it('reads the mechanic from per-mechanic service items', () => {
    expect(mechanicNameFromItem('XXX-JOHAN', 'ONGKOS SERVICE')).toBe('JOHAN');
    expect(mechanicNameFromItem('XXX-PAK DE', 'ONGKOS SERVICE')).toBe('PAK DE');
    expect(mechanicNameFromItem('XXX-AAN', 'Ongkos Service ')).toBe('AAN');
  });

  it('skips generic service items, other services and outside workshops', () => {
    expect(mechanicNameFromItem('XXX-SVC-XXX', 'ONGKOS SERVICE')).toBeNull();
    expect(mechanicNameFromItem('XXX-TANGKAI_SVC', 'ONGKOS SERVICE')).toBeNull();
    expect(mechanicNameFromItem('XXX-SVC-XXX_BAN', 'ONGKOS SERVICE BAN, ROKER BAN, BALANCING, SPOORING')).toBeNull();
    expect(mechanicNameFromItem('XXX-TAMBAL BAN', 'Ongkos Tambal Ban')).toBeNull();
    expect(mechanicNameFromItem('XXX-GRAND AUTO', 'ONGKOS SERVICE')).toBeNull();
    expect(mechanicNameFromItem('XXX-BOMBA', 'SERVICE')).toBeNull();
    expect(mechanicNameFromItem('ONGKOS BUBUT HEAD', 'ONGKOS BUBUT HEAD')).toBeNull();
  });

  it('matches a mechanic to the salesman entry of the same person', () => {
    expect(normalizePersonName('XXX-EKI')).toBe(normalizePersonName('EKI'));
    expect(normalizePersonName('DEO MEKANIK')).toBe(normalizePersonName('DEO'));
    expect(normalizePersonName('NANANG')).not.toBe(normalizePersonName('NANG'));
  });
});
