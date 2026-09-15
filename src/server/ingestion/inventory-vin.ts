/** Validate identity independently of descriptive metadata. Older vehicles used
 * manufacturer-specific serials; modern VINs need no check-digit inference.
 */
export function inventoryVin(value: string, year: string): string | null {
  const vin = value.trim().toUpperCase();
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return vin;
  return /^\d{4}$/.test(year.trim()) &&
    Number(year) >= 1886 &&
    Number(year) < 1981 &&
    /^[A-Z0-9]{5,16}$/.test(vin) &&
    /\d/.test(vin)
    ? vin
    : null;
}
