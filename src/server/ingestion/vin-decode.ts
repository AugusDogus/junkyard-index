import { z } from "zod";
import { VehicleName } from "~/lib/vehicle-name";
import { normalizeCanonicalMake } from "./normalization";

export type VinIdentity = { key: string; vin: string; year: number };
export type VinDecode = {
  make: string;
  model: string;
  year: number;
  trim: string | null;
};

const YEAR_CODES = "ABCDEFGHJKLMNPRSTVWXY123456789";
const resultSchema = z.object({
  VIN: z.string(),
  ErrorCode: z.string(),
  Make: z.string(),
  Model: z.string(),
  ModelYear: z.string(),
  Trim: z.string().nullish(),
});
const responseSchema = z.object({ Results: z.array(z.unknown()) });

function identity(vin: string, year: number): VinIdentity | null {
  const normalized = vin.trim().toUpperCase();
  if (
    !Number.isInteger(year) ||
    year < 1981 ||
    year > 2100 ||
    !/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized) ||
    normalized[9] !== YEAR_CODES[(year - 1980) % 30]
  )
    return null;
  // Keep the plant for every manufacturer. Low-volume WMIs also use 12-14
  // to identify the manufacturer, so those must never share a cache key.
  const manufacturer = normalized[2] === "9" ? normalized.slice(11, 14) : "";
  return {
    key: `${normalized.slice(0, 8)}${normalized.slice(9, 11)}${manufacturer}:${year}`,
    vin: normalized,
    year,
  };
}

function parseResponse(
  body: unknown,
  requests: readonly VinIdentity[],
): Map<string, VinDecode> {
  const parsed = responseSchema.safeParse(body);
  const decodes = new Map<string, VinDecode>();
  if (!parsed.success) return decodes;
  const validRows = parsed.data.Results.flatMap((value) => {
    const row = resultSchema.safeParse(value);
    return row.success ? [row.data] : [];
  });
  for (const request of requests) {
    const matches = validRows.filter(
      (row) => row.VIN.toUpperCase() === request.vin,
    );
    if (matches.length !== 1) continue;
    const row = matches[0];
    if (!row) continue;
    const codes = row.ErrorCode.split(",").map((code) => code.trim());
    // 1 is the check-digit warning. Every other nonzero code rejects identity.
    if (
      !codes.length ||
      codes.some((code) => code !== "0" && code !== "1") ||
      Number(row.ModelYear) !== request.year ||
      !row.Make.trim() ||
      !row.Model.trim()
    )
      continue;
    const make = normalizeCanonicalMake(row.Make);
    if (make === "Other") continue;
    decodes.set(request.key, {
      make,
      model: VehicleName.display(VehicleName.modelName(make, row.Model.trim())),
      year: request.year,
      trim: row.Trim?.trim() || null,
    });
  }
  return decodes;
}

export const VinDecode = { identity, parseResponse } as const;
