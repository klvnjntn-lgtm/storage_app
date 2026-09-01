// components/invoices/CartPanel.tsx
'use client';

import { Minus, Plus, Trash2, Printer, AlertCircle, MapPin, Pencil, Percent, Wrench, X, Bell, CalendarClock, CalendarDays } from 'lucide-react';
import { CartLine, Customer, DiscountType, InvoiceFormat, ServiceLine, TaxRate } from './types';
import { formatIDR } from '@/lib/format';
import { CustomerPicker } from './CustomerPicker';
import { BulkApplyBar } from '@/app/components/shared/BulkApplyBar';

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

function isDueDateBeforeInvoiceDate(dueDate?: string, invoiceDate?: string): boolean {
  if (!dueDate) return false;
  const picked = new Date(dueDate + 'T00:00:00');
  const reference = invoiceDate ? new Date(invoiceDate + 'T00:00:00') : new Date();
  reference.setHours(0, 0, 0, 0);
  return picked < reference;
}

// Small per-line discount control — a None/%/Rp select plus a value input
// when a type is chosen. Shared shape between product lines and service
// lines below; kept inline (not its own component) since it needs the
// line's key threaded through two different change handlers depending on
// which list it's rendered in.
function LineDiscountControl({
  discountType,
  discountValue,
  discountAmount,
  onChange,
}: {
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  onChange: (discountType: DiscountType | null, rawValue?: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 pl-0.5">
      <span className="text-[11px] text-gray-400 shrink-0">Discount</span>
      <select
        value={discountType ?? ''}
        onChange={(e) => {
          const next = (e.target.value || null) as DiscountType | null;
          onChange(next, next ? String(discountValue ?? 0) : undefined);
        }}
        className="text-[11px] border border-gray-300 rounded-md px-1 py-0.5 outline-none"
      >
        <option value="">None</option>
        <option value="PERCENTAGE">%</option>
        <option value="FIXED">Rp</option>
      </select>
      {discountType && (
        <input
          type="number"
          min={0}
          value={discountValue ?? ''}
          onChange={(e) => onChange(discountType, e.target.value)}
          className="w-16 text-[11px] border border-gray-300 rounded-md px-1 py-0.5 outline-none"
        />
      )}
      {discountAmount > 0 && (
        <span className="text-[11px] text-gray-400">−{formatIDR(discountAmount)}</span>
      )}
    </div>
  );
}

export function CartPanel({
  format,
  cartLines,
  customerName,
  setCustomerName,
  customer,
  setCustomer,
  customerNameRequired,
  editingPriceKey,
  setEditingPriceKey,
  changeQty,
  changeUnitPrice,
  removeFromCart,
  stockAtLineLocation,
  posModeEnabled,
  subtotal,
  discount,
  distinctLocationNames,
  onSubmit,
  printing,
  customerPoNumber,
  onChangeCustomerPoNumber,
  paymentTerms,
  onChangePaymentTerms,
  notes,
  onChangeNotes,
  error,
  taxRates,
  onToggleLineTaxRate,
  onApplyTaxToAll,
  onChangeLineDiscount,
  onChangeServiceDiscount,
  onApplyDiscountToAll,
  taxAmount,
  total,
  hasWorkshopRms,
  vehicleId,
  customerVehicles,
  vehiclesLoading,
  onSelectVehicle,
  odometer,
  onChangeOdometer,
  invoiceDate,
  onChangeInvoiceDate,
  dueDate,
  onChangeDueDate,
  reminderOpen,
  onToggleReminderOpen,
  reminderNote,
  onChangeReminderNote,
  reminderDueDate,
  onChangeReminderDueDate,
  onPickReminderPreset,
  onSaveReminder,
  reminderStaged,
  reminderSaving,
  reminderSaved,
  reminderError,
  services,
  onChangeServiceUnit,
  onAddService,
  onChangeServiceDescription,
  onChangeServicePrice,
  onRemoveService,
  onToggleServiceTaxRate,
}: {
  format: InvoiceFormat;
  cartLines: CartLineWithTotals[];
  customerName: string;
  setCustomerName: (v: string) => void;
  customer: Customer | null;
  setCustomer: (c: Customer | null) => void;
  customerNameRequired: boolean;
  editingPriceKey: string | null;
  setEditingPriceKey: (key: string | null) => void;
  changeQty: (key: string, delta: number) => void;
  changeUnitPrice: (key: string, rawValue: string) => void;
  removeFromCart: (key: string) => void;
  stockAtLineLocation: (line: CartLine) => number;
  posModeEnabled: boolean;
  subtotal: number;
  discount: number;
  distinctLocationNames: string[];
  onSubmit: () => void;
  printing: boolean;
  error: string;
  taxRates: TaxRate[];
  onToggleLineTaxRate: (key: string, taxRateId: string) => void;
  onApplyTaxToAll: (taxRateId: string, checked: boolean) => void;
  onChangeLineDiscount: (key: string, discountType: DiscountType | null, rawValue?: string) => void;
  onChangeServiceDiscount: (key: string, discountType: DiscountType | null, rawValue?: string) => void;
  onApplyDiscountToAll: (discountType: DiscountType | null, value: number) => void;
  taxAmount: number;
  total: number;
  hasWorkshopRms?: boolean;
  vehicleId?: string | null;
  customerVehicles?: { id: string; plateNumber: string; vehicleModel: string; odometer?: number | null }[];
  vehiclesLoading?: boolean;
  onSelectVehicle?: (id: string | null) => void;
  odometer?: string;
  onChangeOdometer?: (v: string) => void;
  invoiceDate?: string;
  onChangeInvoiceDate?: (v: string) => void;
  customerPoNumber?: string;
  onChangeServiceUnit?: (key: string, value: string) => void;
  onChangeCustomerPoNumber?: (v: string) => void;
  paymentTerms?: string;
  onChangePaymentTerms?: (v: string) => void;
  notes?: string;
  onChangeNotes?: (v: string) => void;

  dueDate?: string;
  onChangeDueDate?: (v: string) => void;
  reminderOpen?: boolean;
  onToggleReminderOpen?: () => void;
  reminderNote?: string;
  onChangeReminderNote?: (v: string) => void;
  reminderDueDate?: string;
  onChangeReminderDueDate?: (v: string) => void;
  onPickReminderPreset?: (months: number) => void;
  onSaveReminder?: () => void;
  reminderStaged?: boolean;
  reminderSaving?: boolean;
  reminderSaved?: boolean;
  reminderError?: string;
  services?: ServiceLineWithTotals[];
  onAddService?: () => void;
  onChangeServiceDescription?: (key: string, value: string) => void;
  onChangeServicePrice?: (key: string, raw: string) => void;
  onRemoveService?: (key: string) => void;
  onToggleServiceTaxRate?: (key: string, taxRateId: string) => void;
}) {
  const svc = services ?? [];
  const hasEmptyServicePrice = svc.some((s) => s.unitPrice === null);
  const hasEmptyServiceDescription = svc.some((s) => !s.description.trim());
  const nothingToInvoice = cartLines.length === 0 && svc.length === 0;
  const showInvoiceInfoFields = format === 'A5' || format === 'A4';

  // A5 keeps a structured Customer object via CustomerPicker; every other
  // format (A4 included) uses the plain free-text name field. Missing-customer
  // validation therefore has to check whichever of the two is actually in play.
  const missingRequiredCustomer =
    customerNameRequired && (format === 'A5' ? !customer : !customerName.trim());

  return (
    <div className="border-2 border-gray-300 rounded-md p-4 h-fit">
      {cartLines.length > 0 ? (
        <div className="flex items-start gap-1.5 text-xs text-gray-600 mb-3">
          <MapPin size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          {distinctLocationNames.length === 1 ? (
            <span>
              This invoice deducts from <strong>{distinctLocationNames[0]}</strong>
            </span>
          ) : (
            <span>
              Deducting from <strong>{distinctLocationNames.length} locations</strong>: {distinctLocationNames.join(', ')}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-400 mb-3">
          Add items to start this invoice — each item's location is set automatically, and items can come from
          different locations.
        </p>
      )}

      <div className="mb-3">
        <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
          <CalendarDays size={12} strokeWidth={2} />
          Invoice date
        </label>
        <input
          type="date"
          value={invoiceDate ?? ''}
          onChange={(e) => onChangeInvoiceDate?.(e.target.value)}
          placeholder="Today"
          className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
        />
      </div>

      {format === 'A5' ? (
        <CustomerPicker
          value={customer}
          onChange={setCustomer}
          hasError={customerNameRequired && !customer}
        />
      ) : (
        <div className="mb-3">
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder={customerNameRequired ? 'Customer name' : 'Customer name (optional)'}
            className={`w-full border-2 rounded-md p-2 text-sm outline-none focus:border-black ${
              customerNameRequired && !customerName.trim() ? 'border-red-300' : 'border-gray-300'
            }`}
          />
          {customerNameRequired && !customerName.trim() && (
            <p className="flex items-start gap-1.5 text-xs text-red-600 mt-1.5">
              <AlertCircle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
              Customer name is required.
            </p>
          )}
        </div>
      )}

      {showInvoiceInfoFields && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 flex items-center gap-1">
            <CalendarClock size={12} strokeWidth={2} />
            Due date (optional)
          </label>
          <input
            type="date"
            value={dueDate ?? ''}
            onChange={(e) => onChangeDueDate?.(e.target.value)}
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          />
          {isDueDateBeforeInvoiceDate(dueDate, invoiceDate) && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 mt-1.5">
              <AlertCircle size={12} strokeWidth={2} className="shrink-0 mt-0.5" />
              Due date is before invoice date. This invoice will be considered overdue immediately.
            </p>
          )}
        </div>
      )}

      {showInvoiceInfoFields && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Customer PO number (optional)</label>
          <input
            value={customerPoNumber ?? ''}
            onChange={(e) => onChangeCustomerPoNumber?.(e.target.value)}
            placeholder="Customer's reference number"
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          />
        </div>
      )}

      {showInvoiceInfoFields && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Payment terms (optional)</label>
          <input
            value={paymentTerms ?? ''}
            onChange={(e) => onChangePaymentTerms?.(e.target.value)}
            placeholder="e.g. Net 30, Due on receipt"
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          />
        </div>
      )}

      {showInvoiceInfoFields && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Notes (optional)</label>
          <textarea
            value={notes ?? ''}
            onChange={(e) => onChangeNotes?.(e.target.value)}
            rows={2}
            placeholder="Printed on the invoice"
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none"
          />
        </div>
      )}

      {format === 'A5' && hasWorkshopRms && customer && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">Vehicle (optional)</label>
          <select
            value={vehicleId ?? ''}
            onChange={(e) => onSelectVehicle?.(e.target.value || null)}
            className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
          >
            <option value="">
              {vehiclesLoading ? 'Loading vehicles...' : 'No vehicle — general invoice'}
            </option>
            {(customerVehicles ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.plateNumber} · {v.vehicleModel}
              </option>
            ))}
          </select>
          {!vehiclesLoading && (customerVehicles ?? []).length === 0 && (
            <p className="text-xs text-gray-400 mt-1">
              This customer has no vehicles yet — add one from their customer page if this invoice is for a specific car.
            </p>
          )}

          {vehicleId && (
            <div className="mt-2">
              <label className="text-xs text-gray-500 mb-1 block">Odometer (km)</label>
              <input
                type="number"
                min={0}
                value={odometer ?? ''}
                onChange={(e) => onChangeOdometer?.(e.target.value)}
                placeholder="Current odometer reading"
                className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black"
              />
            </div>
          )}

          {vehicleId && (
            <div className="mt-2">
              {!reminderOpen ? (
                <button
                  onClick={onToggleReminderOpen}
                  className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-black underline"
                >
                  <Bell size={12} strokeWidth={2} />
                  Set a reminder for this vehicle
                </button>
              ) : (
                <div className="border-2 border-gray-300 rounded-md p-3 mt-1">
                  <div className="flex items-center justify-between mb-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
                      <Bell size={12} strokeWidth={2} />
                      Reminder
                    </span>
                    <button onClick={onToggleReminderOpen} className="text-gray-400 hover:text-black">
                      <X size={14} strokeWidth={2} />
                    </button>
                  </div>

                  <textarea
                    value={reminderNote ?? ''}
                    onChange={(e) => onChangeReminderNote?.(e.target.value)}
                    placeholder="e.g. Needs another oil change"
                    rows={2}
                    className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none mb-2"
                  />

                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {[
                      { label: '1 month', months: 1 },
                      { label: '2 months', months: 2 },
                      { label: '3 months', months: 3 },
                      { label: '6 months', months: 6 },
                    ].map((preset) => (
                      <button
                        key={preset.months}
                        onClick={() => onPickReminderPreset?.(preset.months)}
                        className="text-xs px-2.5 py-1 rounded-md border border-gray-300 text-gray-700 hover:border-black hover:bg-gray-50"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>

                  <input
                    type="date"
                    value={reminderDueDate ?? ''}
                    onChange={(e) => onChangeReminderDueDate?.(e.target.value)}
                    className="w-full border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black mb-2"
                  />

                  {reminderError && <p className="text-xs text-red-600 mb-2">{reminderError}</p>}
                  {reminderSaved && <p className="text-xs text-green-700 mb-2">Reminder saved.</p>}
                  {!reminderSaved && reminderStaged && (
                    <p className="text-xs text-gray-500 mb-2">Will be added once this invoice is created.</p>
                  )}

                  <button
                    onClick={onSaveReminder}
                    disabled={reminderSaving || reminderSaved || !reminderNote?.trim() || !reminderDueDate}
                    className="w-full flex items-center justify-center gap-2 bg-black text-white rounded-md p-2 text-xs font-semibold disabled:bg-gray-300"
                  >
                    {reminderSaving ? 'Saving...' : reminderStaged ? 'Update reminder' : 'Set reminder'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {cartLines.length === 0 && svc.length === 0 && (
        <p className="text-sm text-gray-400">No items selected yet</p>
      )}

      {(cartLines.length > 0 || svc.length > 0) && (
        <BulkApplyBar
          taxRates={taxRates}
          onApplyTaxToAll={onApplyTaxToAll}
          onApplyDiscountToAll={onApplyDiscountToAll}
        />
      )}

      <div className="flex flex-col divide-y divide-gray-200">
        {cartLines.map((line) => {
          const available = stockAtLineLocation(line);
          const editing = editingPriceKey === line.key;
          const priceEditable = posModeEnabled;
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
                    {priceEditable ? (
                      editing ? (
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
                      )
                    ) : (
                      <span className="text-xs text-gray-500">{formatIDR(line.unitPrice)}</span>
                    )}
                    <span className="text-xs text-gray-400">
                       {line.quantity}
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
                    disabled={!posModeEnabled && line.quantity >= available}
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
                    <span className="text-xs text-gray-400 ml-auto">
                      +{formatIDR(line.lineTaxAmount)}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasWorkshopRms && (
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

          {svc.length === 0 && (
            <p className="text-xs text-gray-400 mb-2">No services added — this invoice can be product-only, service-only, or both.</p>
          )}

          <div className="flex flex-col divide-y divide-gray-200">
            {svc.map((line) => {
              const priceMissing = line.unitPrice === null;
              return (
                <div key={line.key} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-start gap-2">
                    <textarea
                      value={line.description}
                      onChange={(e) => onChangeServiceDescription?.(line.key, e.target.value)}
                      placeholder="What service was done? (e.g. Oil change, brake pad replacement)"
                      rows={2}
                      className="flex-1 border-2 border-gray-300 rounded-md p-2 text-sm outline-none focus:border-black resize-none"
                    />
                    <button
                      onClick={() => onRemoveService?.(line.key)}
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
                        onChange={(e) => onChangeServicePrice?.(line.key, e.target.value)}
                        placeholder="0"
                        className="w-24 text-xs outline-none"
                      />
                    </div>
                    {priceMissing && (
                      <span className="text-[11px] text-red-600">Enter a price — use 0 if free</span>
                    )}
                    <input
                      type="text"
                      value={line.unit ?? ''}
                      onChange={(e) => onChangeServiceUnit?.(line.key, e.target.value)}
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
                              onChange={() => onToggleServiceTaxRate?.(line.key, rate.id)}
                              className="w-3.5 h-3.5 accent-black"
                            />
                            {rate.name} ({rate.percentage}%)
                          </label>
                        );
                      })}
                      {line.lineTaxAmount > 0 && (
                        <span className="text-xs text-gray-400 ml-auto">
                          +{formatIDR(line.lineTaxAmount)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        disabled={
          nothingToInvoice ||
          printing ||
          missingRequiredCustomer ||
          hasEmptyServicePrice ||
          hasEmptyServiceDescription
        }
        className="w-full mt-4 flex items-center justify-center gap-2 bg-black text-white rounded-md p-3 text-sm font-semibold disabled:bg-gray-300 disabled:cursor-not-allowed"
      >
        <Printer size={16} strokeWidth={2} />
        {printing ? 'Printing...' : 'Create & Print Invoice'}
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