'use client';

import { useCallback } from 'react';
import { useLanguage } from '@/app/context/LanguageContext';

// The built-in chart of accounts is created with English names (backend
// chart-of-accounts-seed.service.ts). They're stored data, not UI text, so a business can rename
// them — but an untouched default name is shown in Indonesian when the app is in Indonesian.
const ID_NAMES: Record<string, string> = {
  'Cash on Hand': 'Kas',
  Bank: 'Bank',
  'Accounts Receivable': 'Piutang Usaha',
  Inventory: 'Persediaan',
  'Input VAT Receivable': 'PPN Masukan',
  'Advances to Suppliers': 'Uang Muka Pembelian',
  'Accounts Payable': 'Utang Usaha',
  'Output VAT Payable': 'PPN Keluaran',
  'Payroll Payable': 'Utang Gaji',
  'Payroll Deductions Payable': 'Utang Potongan Gaji',
  'Expense Payable': 'Utang Beban',
  'Customer Deposits': 'Uang Muka Penjualan',
  'Retained Earnings': 'Laba Ditahan',
  'Opening Balance Equity': 'Ekuitas Saldo Awal',
  'Sales Revenue': 'Pendapatan Penjualan',
  'Cost of Goods Sold': 'Harga Pokok Penjualan',
  'Salary Expense': 'Beban Gaji',
  'Uncategorized Expense': 'Beban Tanpa Kategori',
  'Inventory Adjustments': 'Penyesuaian Persediaan',
  'Fixed Assets': 'Aset Tetap',
  'Accumulated Depreciation': 'Akumulasi Penyusutan',
  'Fixed Asset Payable': 'Utang Aset Tetap',
  'Depreciation Expense': 'Beban Penyusutan',
  'Gain on Disposal of Assets': 'Laba Pelepasan Aset',
  'Loss on Disposal of Assets': 'Rugi Pelepasan Aset',
  'Prepaid Expenses': 'Biaya Dibayar di Muka',
  'Intangible Assets': 'Aset Tak Berwujud',
  'Accumulated Amortization': 'Akumulasi Amortisasi',
  'Amortization Expense': 'Beban Amortisasi',
};

export function translateAccountName(name: string, language: string): string {
  return language === 'id' ? (ID_NAMES[name] ?? name) : name;
}

// (name) => the name to show, in the current language.
export function useAccountName() {
  const { language } = useLanguage();
  return useCallback((name: string) => translateAccountName(name, language), [language]);
}
