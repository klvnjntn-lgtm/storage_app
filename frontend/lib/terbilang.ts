// lib/terbilang.ts
const SATUAN = [
  '', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan',
  'sepuluh', 'sebelas',
];

function angkaKeHuruf(n: number): string {
  if (n < 12) return SATUAN[n];
  if (n < 20) return `${angkaKeHuruf(n - 10)} belas`;
  if (n < 100) {
    const sisa = n % 10;
    return `${angkaKeHuruf(Math.floor(n / 10))} puluh${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 200) {
    const sisa = n - 100;
    return `seratus${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 1000) {
    const sisa = n % 100;
    return `${angkaKeHuruf(Math.floor(n / 100))} ratus${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 2000) {
    const sisa = n - 1000;
    return `seribu${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 1_000_000) {
    const sisa = n % 1000;
    return `${angkaKeHuruf(Math.floor(n / 1000))} ribu${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 1_000_000_000) {
    const sisa = n % 1_000_000;
    return `${angkaKeHuruf(Math.floor(n / 1_000_000))} juta${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  if (n < 1_000_000_000_000) {
    const sisa = n % 1_000_000_000;
    return `${angkaKeHuruf(Math.floor(n / 1_000_000_000))} miliar${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
  }
  const sisa = n % 1_000_000_000_000;
  return `${angkaKeHuruf(Math.floor(n / 1_000_000_000_000))} triliun${sisa ? ` ${angkaKeHuruf(sisa)}` : ''}`;
}

export function terbilang(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new Error('terbilang: amount must be a finite number');
  }
  const rounded = Math.round(Math.max(amount, 0));
  const words = rounded === 0 ? 'nol' : angkaKeHuruf(rounded);
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} rupiah`;
}