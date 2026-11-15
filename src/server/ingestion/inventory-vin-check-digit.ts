import { inventoryVin } from "./inventory-vin";

const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const letters = "ABCDEFGHJKLMNPRSTUVWXYZ";
const values = "12345678123457923456789";
/** North American VINs must carry a valid ISO 3779 check digit.
 * Pre-1981 serials still use the shared older-vehicle identity rule. */
export function inventoryVinWithCheckDigit(
  raw: string,
  year: string,
): string | null {
  const vin = inventoryVin(raw, year);
  if (vin === null || vin.length !== 17) return vin;
  if (/^([A-HJ-NPR-Z0-9])\1{16}$/.test(vin)) return null;
  let sum = 0;
  for (const [index, char] of [...vin].entries()) {
    const value = /^\d$/.test(char)
      ? Number(char)
      : Number(values[letters.indexOf(char)]);
    const weight = weights[index];
    if (!Number.isFinite(value) || weight === undefined) return null;
    sum += value * weight;
  }
  const remainder = sum % 11;
  return vin[8] === (remainder === 10 ? "X" : String(remainder)) ? vin : null;
}
