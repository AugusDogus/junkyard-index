import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { vinplusOptionalText } from "./vinplus-protocol";
import { vinplusPublicDate } from "./vinplus-public-enrichment";
import {
  pipesPhotoStock,
  type PipesNativeRow,
  type PipesRecord,
} from "./pipes-parser";
import { PIPES_INVENTORY_URL, PIPES_YARD } from "./pipes-yard-metadata";

export type PipesCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "pipes";
};
export type PipesDisposition =
  | { status: "available"; vehicle: PipesCanonicalVehicle }
  | {
      status: "incomplete";
      reason: "native_required_fields" | "identity_unavailable";
      vin: string | null;
    };

export function transformPipesRecord(
  native: PipesNativeRow,
  record: PipesRecord | undefined,
): PipesDisposition {
  const vin =
    record && typeof record.vin === "string"
      ? inventoryVin(
          record.vin,
          native.year === null ? "" : String(native.year),
        )
      : null;
  const nativeMake = vinplusOptionalText(native.make),
    model = vinplusOptionalText(native.model);
  if (native.year === null || !nativeMake || !model)
    return { status: "incomplete", reason: "native_required_fields", vin };
  if (!vin || !record)
    return { status: "incomplete", reason: "identity_unavailable", vin: null };
  const reference = vinplusOptionalText(native.reference);
  const engine =
    reference &&
    /^[LVHIBW]\d{1,2},\s*\d+(?:\.\d+)?L(?:;\s*(?:SOHC|DOHC))?;?$/i.test(
      reference,
    )
      ? reference
      : null;
  return {
    status: "available",
    vehicle: {
      source: "pipes",
      vin,
      year: native.year,
      make: normalizeCanonicalMake(nativeMake),
      model,
      color: normalizeCanonicalColor(vinplusOptionalText(native.color)),
      stockNumber: record.stock,
      imageUrl:
        [...native.photos, ...native.images].find(
          (photo) => pipesPhotoStock(photo) === record.stock,
        ) ?? null,
      availableDate: vinplusPublicDate(record.dateAdded)?.value ?? null,
      locationCode: PIPES_YARD.code,
      locationName: PIPES_YARD.name,
      locationCity: PIPES_YARD.city,
      state: "Louisiana",
      stateAbbr: "LA",
      lat: PIPES_YARD.lat,
      lng: PIPES_YARD.lng,
      section: null,
      row: vinplusOptionalText(native.row),
      space: null,
      detailsUrl: PIPES_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: null,
      engine,
      trim: null,
      transmission: null,
    },
  };
}

/** Native donors and owned API-only quarantines each receive one disposition.
 * Repeated selector coverage never creates another donor or VIN presence.
 */
export function classifyPipesInventory(
  rows: readonly PipesNativeRow[],
  records: ReadonlyMap<string, PipesRecord>,
) {
  const vehicles: PipesCanonicalVehicle[] = [],
    observed = new Set<string>();
  const nativeStocks = new Set(
    rows.flatMap((row) => (row.stock ? [row.stock] : [])),
  );
  let rejected = 0,
    quarantined = 0;
  for (const row of rows) {
    const record = row.stock ? records.get(row.stock) : undefined;
    if (record && row.year !== null && row.year !== record.year)
      throw new Error("Pipes native/API year conflict for " + record.stock);
    const result = transformPipesRecord(row, record);
    if (result.status === "available") vehicles.push(result.vehicle);
    else {
      rejected++;
      if (result.vin) observed.add(result.vin);
    }
  }
  for (const record of records.values()) {
    if (nativeStocks.has(record.stock)) continue;
    quarantined++;
    rejected++;
    const vin =
      typeof record.vin === "string"
        ? inventoryVin(record.vin, String(record.year))
        : null;
    if (vin) observed.add(vin);
  }
  return {
    vehicles,
    observedVins: [...observed].sort(),
    rejected,
    quarantined,
    processed: rows.length + quarantined,
  };
}
