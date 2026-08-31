// components/sales-orders/SalesOrderCartPanel.tsx
'use client';

import { Minus, Plus, Trash2, Send, AlertCircle, MapPin, Pencil, Percent, Wrench, X } from 'lucide-react';
import { CartLine, Customer, DiscountType, ServiceLine, TaxRate } from './types';
import { formatIDR } from '@/lib/format';
import { CustomerPicker } from '@/app/components/invoices/CustomerPicker';
import { BulkApplyBar } from '@/app/components/shared/BulkApplyBar';
import { LineDiscountControl } from '@/app/components/shared/LineDiscountControl';

type CartLineWithTotals = CartLine & {
  key: string;
  lineSubtotal: number;
  lineDiscountAmount: number;
  netAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
};

type ServiceLineWithTotals = ServiceLine & {
  lineSubtotal: number;
  lineDiscountAmount: number;
  netAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
};

export function SalesOrderCartPanel({
  cartLines,
  customer,
  setCustomer,
  customerPoNumber,
  setCustomerPoNumber,
  orderDate,
  setOrderDate,
  editingPriceKey,
  setEditingPriceKey,
  changeQty,
  changeUnitPrice,
  removeFromCart,
  stockAtLineLocation,
  subtotal,
  discount,
  distinctLocationNames,
  onSubmit,
  saving,
  error,
  taxRates,
  onToggleLineTaxRate,
  onApplyTaxToAll,
  onChangeLineDiscount,
  onChangeServiceDiscount,
  onApplyDiscountToAll,
  taxAmount,
  total,
  services,
  onAddService,
  onChangeServiceDescription,
  onChangeServicePrice,
  onChangeServiceUnit,
  onRemoveService,
  onToggleServiceTaxRate,
}: {
  cartLines: CartLineWithTotals[];
  customer: Customer | null;
  setCustomer: (c: Customer | null) => void;
  customerPoNumber: string;
  setCustomerPoNumber: (v: string) => void;
  orderDate: string;
  setOrderDate: (v: string) => void;
  editingPriceKey: string | null;
  setEditingPriceKey: (key: string | null) => void;
  changeQty: (key: string, delta: number) => void;
  changeUnitPrice: (key: string, rawValue: string) => void;
  removeFromCart: (key: string) => void;
  stockAtLineLocation: (line: CartLine) => number;
  subtotal: number;
  discount: number;
  distinctLocationNames: string[];
  onSubmit: () => void;
  saving: boolean;
  error: string;
  taxRates: TaxRate[];
  onToggleLineTaxRate: (key: string, taxRateId: string) => void;
  onApplyTaxToAll: (taxRateId: string, checked: boolean) => void;
  onChangeLineDiscount: (key: string, discountType: DiscountType | null, rawValue?: string) => void;
  onChangeServiceDiscount: (key: string, discountType: DiscountType | null, rawValue?: string) => void;
  onApplyDiscountToAll: (discountType: DiscountType | null, value: number) => void;
  taxAmount: number;
  total: number;
  services: ServiceLineWithTotals[];
  onAddService: () => void;
  onChangeServiceDescription: (key: string, value: string) => void;
  onChangeServicePrice: (key: string, raw: string) => void;
  onChangeServiceUnit: (key: string, value: string) => void;
  onRemoveService: (key: string) => void;
  onToggleServiceTaxRate: (key: string, taxRateId: string) => void;
}) {
  const hasEmptyServicePrice = services.some((s) => s.unitPrice === null);
  const hasEmptyServiceDescription = services.some((s) => !s.description.trim());
  const nothingToOrder = cartLines.length === 0 && services.length === 0;

  return (
    <div className="border-2 border-gray-300 rounded-md p-4 h-fit">
      {cartLines.length > 0 ? (
        <div className="flex items-start gap-1.5 text-xs text-gray-600 mb-3">
          <MapPin size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          {distinctLocationNames.length === 1 ? (
            <span>
              Priced from <strong>{distinctLocationNames[0]}</strong>
            </span>
          ) : (
            <span>
              Priced across <strong>{distinctLocationNames.length} locations</strong>: {distinctLocationNames.join(', ')}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 mb-3">
          Add items to start this order — each item's location is set automatically.
        </p>
      )}

      <CustomerPicker value={customer} onChange={setCustomer} hasError={!customer} />

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div>
          <label className="text-[11px] text-gray-500">PO Number</label>
          <input
            type="text"
            value={customerPoNumber}
            onChange={(e) => setCustomerPoNumber(e.target.value)}
            placeholder="Optional"
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          />
        </div>
        <div>
          <label className="text-[11px] text-gray-500">Order Date</label>
          <input
            type="date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          />
        </div>
      </div>

      {cartLines.length === 0 && services.length === 0 && (
        <p className="text-sm text-gray-400 mt-3">No items selected yet</p>
      )}

      {(cartLines.length > 0 || services.length > 0) && (
        <div className="mt-3">
          <BulkApplyBar
            taxRates={taxRates}
            onApplyTaxToAll={onApplyTaxToAll}
            onApplyDiscountToAll={onApplyDiscountToAll}
          />
        </div>
      )}

      <div className="flex flex-col divide-y divide-gray-200 mt-3">
        {cartLines.map((line) => {
          const editing = editingPriceKey === line.key;
          const available = stockAtLineLocation(line);
          return (
            <div key={line.key} className="flex flex-col gap-2 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{line.product.name}</p>
                  <div className="flex items-center gap-1 text-[11px] text-gray-400 mt-0.5">
                    <MapPin size={10} strokeWidth={2} className="shrink-0" />
                    <span className="truncate">{line.locationName}</span>
                  </div>

                  <div className="flex items-center gap-2 mt-1.5">
                    {editing ? (
                      <div className="flex items-center gap-1 bg-white border-2 border-black rounded-md pl-2 pr-1 py-1">
                        <span className="text-xs text-gray-400">Rp</span>
                        <input
                          type="number"
                          min={0}
                          autoFocus
                          value={line.unitPrice}
                          onChange={(e) => changeUnitPrice(line.key, e.target.value)}
                          onBlur={() => setEditingPriceKey(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingPriceKey(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-20 text-xs outline-none"
                        />
                      </div>
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPriceKey(line.key);
                        }}
                        className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50 transition-colors"
                      >
                        <Pencil size={10} strokeWidth={2} className="text-gray-400" />
                        {formatIDR(line.unitPrice)}
                      </button>
                    )}
                    <span className="text-xs text-gray-400">
                      × {line.quantity}
                      {line.unit ? ` ${line.unit}` : ''} ={' '}
                      <span className="font-medium text-gray-700">{formatIDR(line.lineSubtotal)}</span>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => changeQty(line.key, -1)}
                    className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100"
                  >
                    <Minus size={14} strokeWidth={2} />
                  </button>
                  <span className="w-5 text-center text-sm">{line.quantity}</span>
                  <button
                    onClick={() => changeQty(line.key, 1)}
                    disabled={line.quantity >= available}
                    className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => removeFromCart(line.key)}
                    className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600"
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </div>
              </div>

              <LineDiscountControl
                discountType={line.discountType}
                discountValue={line.discountValue}
                discountAmount={line.lineDiscountAmount}
                onChange={(discountType, rawValue) => onChangeLineDiscount(line.key, discountType, rawValue)}
              />

              {taxRates.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5">
                  <span className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Percent size={10} strokeWidth={2} />
                    Tax
                  </span>
                  {taxRates.map((rate) => {
                    const checked = line.taxRateIds.includes(rate.id);
                    return (
                      <label
                        key={rate.id}
                        className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => onToggleLineTaxRate(line.key, rate.id)}
                          className="w-3.5 h-3.5 accent-black"
                        />
                        {rate.name} ({rate.percentage}%)
                      </label>
                    );
                  })}
                  {line.lineTaxAmount > 0 && (
                    <span className="text-xs text-gray-400 ml-auto">+{formatIDR(line.lineTaxAmount)}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Services — a free-text line item alongside stocked products, same
          as quotations. The backend prices these via the same
          LineItemPricingService, keyed by description instead of productId. */}
      <div className="mt-3 pt-3 border-t-2 border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
            <Wrench size={12} strokeWidth={2} />
            Services
          </span>
          <button
            onClick={onAddService}
            className="text-xs px-2 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
          >
            + Add service
          </button>
        </div>

        {services.length === 0 && (
          <p className="text-xs text-gray-400 mb-2">
            No services added — this order can be product-only, service-only, or both.
          </p>
        )}

        <div className="flex flex-col divide-y divide-gray-200">
          {services.map((line) => {
            const priceMissing = line.unitPrice === null;
            return (
              <div key={line.key} className="flex flex-col gap-2 py-2.5">
                <div className="flex items-start gap-2">
                  <textarea
                    value={line.description}
                    onChange={(e) => onChangeServiceDescription(line.key, e.target.value)}
                    placeholder="Describe the service or work being ordered"
                    rows={2}
                    className="flex-1 border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none"
                  />
                  <button
                    onClick={() => onRemoveService(line.key)}
                    className="w-7 h-7 flex items-center justify-center border border-gray-300 rounded-md hover:bg-red-50 hover:border-red-300 text-red-600 shrink-0"
                  >
                    <X size={14} strokeWidth={2} />
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div
                    className={`flex items-center gap-1 border-2 rounded-md pl-2 pr-1 py-1 ${
                      priceMissing ? 'border-red-300' : 'border-gray-300'
                    }`}
                  >
                    <span className="text-xs text-gray-400">Rp</span>
                    <input
                      type="number"
                      min={0}
                      value={line.unitPrice ?? ''}
                      onChange={(e) => onChangeServicePrice(line.key, e.target.value)}
                      placeholder="0"
                      className="w-24 text-xs outline-none"
                    />
                  </div>
                  {priceMissing && <span className="text-[11px] text-red-600">Enter a price — use 0 if free</span>}

                  <input
                    type="text"
                    value={line.unit ?? ''}
                    onChange={(e) => onChangeServiceUnit(line.key, e.target.value)}
                    placeholder="Unit (optional)"
                    className="w-28 border-2 border-gray-300 rounded-md px-2 py-1 text-xs outline-none focus:border-black"
                  />
                </div>

                <LineDiscountControl
                  discountType={line.discountType}
                  discountValue={line.discountValue}
                  discountAmount={line.lineDiscountAmount}
                  onChange={(discountType, rawValue) => onChangeServiceDiscount(line.key, discountType, rawValue)}
                />

                {taxRates.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-gray-400">
                      <Percent size={10} strokeWidth={2} />
                      Tax
                    </span>
                    {taxRates.map((rate) => {
                      const checked = line.taxRateIds.includes(rate.id);
                      return (
                        <label
                          key={rate.id}
                          className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => onToggleServiceTaxRate(line.key, rate.id)}
                            className="w-3.5 h-3.5 accent-black"
                          />
                          {rate.name} ({rate.percentage}%)
                        </label>
                      );
                    })}
                    {line.lineTaxAmount > 0 && (
                      <span className="text-xs text-gray-400 ml-auto">+{formatIDR(line.lineTaxAmount)}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t-2 border-gray-300 mt-3 pt-3 space-y-1">
        <div className="flex justify-between items-center text-sm text-gray-600">
          <span>Subtotal</span>
          <span>{formatIDR(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div className="flex justify-between items-center text-sm text-gray-600">
            <span>Discount</span>
            <span>−{formatIDR(discount)}</span>
          </div>
        )}
        {taxAmount > 0 && (
          <div className="flex justify-between items-center text-sm text-gray-600">
            <span>Tax</span>
            <span>{formatIDR(taxAmount)}</span>
          </div>
        )}
        <div className="flex justify-between items-center font-bold pt-1">
          <span>Total</span>
          <span>{formatIDR(total)}</span>
        </div>
      </div>

      <button
        onClick={onSubmit}
        disabled={nothingToOrder || saving || !customer || hasEmptyServicePrice || hasEmptyServiceDescription}
        className="w-full mt-4 flex items-center justify-center gap-2 bg-black text-white rounded-md p-3 text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        <Send size={16} strokeWidth={2} />
        {saving ? 'Saving...' : 'Save Sales Order'}
      </button>

      {error && (
        <div className="flex items-start gap-2 bg-red-50 border-2 border-red-300 text-red-800 rounded-md p-3 text-sm mt-3">
          <AlertCircle size={16} strokeWidth={2} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}
    </div>
  );
}