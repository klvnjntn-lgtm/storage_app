// The backend refuses an odometer reading below the car's last one (invoices, work orders,
// quotations); the forms flag it while typing and hold the submit button.
export function isOdometerBelowLast(input: string | null | undefined, last: number | null | undefined): boolean {
  if (last == null || !input?.trim()) return false;
  const reading = Number(input);
  return Number.isFinite(reading) && reading < last;
}
