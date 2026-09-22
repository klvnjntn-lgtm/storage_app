// components/payroll/templates/PayslipA4Template.tsx
'use client';

import { PayslipPrintView } from '../types';
import { formatIDR } from '@/lib/format';
import { terbilang } from '@/lib/terbilang';
import { resolveUploadUrl } from '@/lib/assets';
import { parseCalendarDate } from '@/lib/dates';
import { useLanguage } from '@/app/context/LanguageContext';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PayslipA4Template({ payslip }: { payslip: PayslipPrintView }) {
  const { t, language } = useLanguage();
  const logoUrl = resolveUploadUrl(payslip.businessLogoUrl);

  const allowances = payslip.components.filter((c) => c.type === 'ALLOWANCE');
  const deductions = payslip.components.filter((c) => c.type === 'DEDUCTION');

  return (
    <div className="w-[210mm] p-[15mm] text-sm text-black bg-white">
      {/* Business identity + payslip meta */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex items-start gap-3">
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-20 w-20 object-contain" />
          )}

          <div>
            <h2 className="text-2xl font-bold leading-tight text-black">{payslip.businessName}</h2>
            {payslip.businessAddress && <p className="text-xs text-gray-600">{payslip.businessAddress}</p>}
            {payslip.businessPhone && <p className="text-xs text-gray-600">{payslip.businessPhone}</p>}
            {payslip.businessNpwp && <p className="text-xs text-gray-600">NPWP: {payslip.businessNpwp}</p>}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className="text-lg text-black">
            <strong>{t('accounting.payroll.payslipTemplate.title')}</strong>
          </p>
          <p className="text-gray-600">
            {MONTH_NAMES[payslip.periodMonth - 1]} {payslip.periodYear}
          </p>
          <p className="text-gray-600">
            {t('accounting.payroll.payslipTemplate.documentDate')}{' '}
            {parseCalendarDate(payslip.documentDate).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
          </p>
          {payslip.status === 'PAID' && payslip.paidAt && (
            <p className="text-gray-600">
              {t('accounting.payroll.payslipTemplate.paidOn')}{' '}
              {parseCalendarDate(payslip.paidAt).toLocaleDateString(language === 'id' ? 'id-ID' : 'en-US')}
            </p>
          )}
        </div>
      </div>

      {/* Employee */}
      <div className="mt-6 border-t border-gray-300 pt-3">
        <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
          {t('accounting.payroll.payslipTemplate.employee')}
        </p>
        <p className="font-semibold text-base text-black">{payslip.employeeName}</p>
        {payslip.employeePosition && <p className="text-black">{payslip.employeePosition}</p>}
        {payslip.employeeNik && (
          <p className="text-xs text-gray-600">{t('accounting.payroll.payslipTemplate.nik', { nik: payslip.employeeNik })}</p>
        )}
        {payslip.employeeBankName && payslip.employeeBankAccountNumber && (
          <p className="text-xs text-gray-600">
            {payslip.employeeBankName} — {payslip.employeeBankAccountNumber}
          </p>
        )}
      </div>

      {/* Earnings */}
      <table className="w-full border-collapse mt-6">
        <thead>
          <tr>
            <th className="text-left border-b-2 border-gray-300 py-2 pr-3 text-black">
              {t('accounting.payroll.payslipTemplate.colEarnings')}
            </th>
            <th className="text-right border-b-2 border-gray-300 py-2 pl-3 text-black">
              {t('accounting.payroll.payslipTemplate.colAmount')}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border-b border-gray-100 py-2 pr-3 text-black">
              {t('accounting.payroll.payslipTemplate.baseSalary')}
            </td>
            <td className="border-b border-gray-100 py-2 pl-3 text-right text-black whitespace-nowrap">
              {formatIDR(payslip.baseSalary)}
            </td>
          </tr>
          {allowances.map((c, index) => (
            <tr key={`${c.name}-${index}`}>
              <td className="border-b border-gray-100 py-2 pr-3 text-black">{c.name}</td>
              <td className="border-b border-gray-100 py-2 pl-3 text-right text-black whitespace-nowrap">
                {formatIDR(c.amount)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-2 pr-3 text-right font-semibold text-black">
              {t('accounting.payroll.payslipTemplate.grossPay')}
            </td>
            <td className="py-2 pl-3 text-right font-semibold text-black whitespace-nowrap">
              {formatIDR(payslip.grossPay)}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Deductions */}
      {deductions.length > 0 && (
        <table className="w-full border-collapse mt-4">
          <thead>
            <tr>
              <th className="text-left border-b-2 border-gray-300 py-2 pr-3 text-black">
                {t('accounting.payroll.payslipTemplate.colDeductions')}
              </th>
              <th className="text-right border-b-2 border-gray-300 py-2 pl-3 text-black">
                {t('accounting.payroll.payslipTemplate.colAmount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {deductions.map((c, index) => (
              <tr key={`${c.name}-${index}`}>
                <td className="border-b border-gray-100 py-2 pr-3 text-black">{c.name}</td>
                <td className="border-b border-gray-100 py-2 pl-3 text-right text-gray-600 whitespace-nowrap">
                  -{formatIDR(c.amount)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 text-right font-semibold text-black">
                {t('accounting.payroll.payslipTemplate.totalDeductions')}
              </td>
              <td className="py-2 pl-3 text-right font-semibold text-black whitespace-nowrap">
                -{formatIDR(payslip.totalDeductions)}
              </td>
            </tr>
          </tbody>
        </table>
      )}

      {/* Net pay */}
      <div className="ml-auto w-1/2 mt-4">
        <div className="flex justify-between font-bold text-lg border-t-2 border-black pt-2 mt-2 text-black">
          <span>{t('accounting.payroll.payslipTemplate.netPay')}</span>
          <span>{formatIDR(payslip.netPay)}</span>
        </div>
      </div>

      {/* Amount in words */}
      <p className="mt-4 text-xs italic text-gray-600">
        {t('accounting.payroll.payslipTemplate.terbilang')}: {terbilang(payslip.netPay)}
      </p>

      {/* Signature blocks */}
      <div className="mt-16 flex justify-between gap-4">
        <div className="text-center w-40">
          <p className="text-black">{t('accounting.payroll.payslipTemplate.employeeSignature')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">{payslip.employeeName}</p>
        </div>

        <div className="text-center w-40">
          <p className="text-black">{t('accounting.payroll.payslipTemplate.sincerely')}</p>
          <div className="h-20" />
          <p className="border-t border-gray-400 pt-1 text-black">{payslip.businessName}</p>
        </div>
      </div>
    </div>
  );
}
