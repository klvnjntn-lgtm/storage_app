import { guessCar } from './part-catalog.service';

// The plate lookup opens the catalogue on the vehicle's free-text model when no catalogue car was saved.
describe('guessCar', () => {
  const brands = [
    { brand: 'Toyota', models: ['Avanza', 'Veloz', 'Kijang Innova', 'Innova Zenix'] },
    { brand: 'Daihatsu', models: ['Xenia'] },
    { brand: 'Honda', models: ['Jazz', 'HR-V'] },
  ];

  it.each([
    ['Avanza 1.3 G 2015', { brand: 'Toyota', model: 'Avanza', year: 2015 }],
    ['TOYOTA KIJANG INNOVA 2.0 V', { brand: 'Toyota', model: 'Kijang Innova', year: null }],
    ['Innova Zenix Hybrid 2023', { brand: 'Toyota', model: 'Innova Zenix', year: 2023 }],
    ['honda hr-v 1.5 2019', { brand: 'Honda', model: 'HR-V', year: 2019 }],
    ['Xenia R 1300', { brand: 'Daihatsu', model: 'Xenia', year: null }],
  ])('reads %s', (text, car) => {
    expect(guessCar(text, brands)).toEqual({ ...car, guessed: true });
  });

  it('gives up on text it cannot place', () => {
    expect(guessCar('Mobil box putih', brands)).toBeNull();
  });
});
