import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { SandwInventory, SandwRecord } from "./sandw-parser";
import {
  SANDW_CATALOG,
  SANDW_MINIMUM_UNIQUE_INVENTORY,
  SANDW_YARD,
} from "./sandw-yard-metadata";

export type SandwCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "sandw";
};
const optionalText = (raw: unknown): string | null =>
  typeof raw === "string" &&
  raw.trim().length > 0 &&
  raw.length <= 200 &&
  ![...raw].some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  ) &&
  !/^(?:unknown|other|n\/?a|null|none|not available|-)$/i.test(raw.trim())
    ? raw.trim()
    : null;
const date = (raw: unknown): string | null => {
  if (
    typeof raw !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(raw)
  )
    return null;
  const value = new Date(raw);
  return Number.isFinite(value.getTime()) && value.toISOString() === raw
    ? raw.slice(0, 10)
    : null;
};
const image = (raw: unknown, stock: string | null) => {
  if (typeof raw !== "string" || stock === null) return null;
  const url = URL.parse(raw);
  // No native photos were published in the qualification report. Future
  // photos require an owned, stock-bound path rather than a guessed CDN.
  return url &&
    url.origin === "https://www.sandwauto.com" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password &&
    url.pathname.split("/").includes(stock) &&
    /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    ? url.href
    : null;
};

export function transformSandwRecord(
  record: SandwRecord,
):
  | { status: "available"; vehicle: SandwCanonicalVehicle }
  | { status: "rejected"; observedVins: string[] } {
  const rawYear = String(record.year ?? "");
  const year = /^\d{4}$/.test(rawYear) ? Number(rawYear) : 0;
  const vin = inventoryVin(record.vin ?? "", rawYear);
  const make = optionalText(record.make),
    model = optionalText(record.model);
  if (
    !vin ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    !model ||
    (record.vinLast6 !== null &&
      record.vinLast6 !== undefined &&
      record.vinLast6 !== "" &&
      record.vinLast6 !== vin.slice(-6))
  )
    return { status: "rejected", observedVins: vin ? [vin] : [] };
  const stock = optionalText(record.stockNumber);
  const location = optionalText(record.location);
  return {
    status: "available",
    vehicle: {
      source: "sandw",
      vin,
      year,
      make: normalizeCanonicalMake(make),
      model,
      color: optionalText(record.color),
      stockNumber: stock,
      imageUrl: image(record.imageUrl, stock),
      availableDate: date(record.arrivalDate),
      locationCode: SANDW_YARD.code,
      locationName: SANDW_YARD.name,
      locationCity: SANDW_YARD.city,
      state: "Georgia",
      stateAbbr: "GA",
      lat: SANDW_YARD.lat,
      lng: SANDW_YARD.lng,
      row: location?.match(/^Row (\d+)$/)?.[1] ?? null,
      section: null,
      space: null,
      // The native UI has no donor detail/deep-filter URL. Use its actual
      // searchable VIN/stock catalog, without inventing a query or fragment.
      detailsUrl: SANDW_CATALOG,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}

const optionalKeys = [
  "color",
  "stockNumber",
  "imageUrl",
  "availableDate",
  "row",
] as const;
export function sandwSnapshot(report: SandwInventory) {
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: report.vehicles.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, SandwCanonicalVehicle>();
  const observed = new Set<string>(),
    identities = new Map<string, string>();
  const stocks = new Map<string, Set<string>>();
  const metadata = new Map<
    string,
    Record<(typeof optionalKeys)[number], Set<string>>
  >();
  for (const record of report.vehicles) {
    const vin = inventoryVin(record.vin ?? "", String(record.year ?? ""));
    const stock = optionalText(record.stockNumber);
    if (vin) {
      // Compare native YMM before display normalization. Even incomplete rows
      // must not let a conflicting copy of a supplied identity be emitted.
      const identity = JSON.stringify([record.year, record.make, record.model]);
      const previous = identities.get(vin);
      if (previous !== undefined && previous !== identity)
        throw new Error(
          "S&W repeated VIN has conflicting native YMM; no inventory was emitted",
        );
      identities.set(vin, identity);
      if (stock) {
        const claims = stocks.get(stock) ?? new Set<string>();
        claims.add(vin);
        stocks.set(stock, claims);
        if (claims.size > 1)
          throw new Error(
            "S&W native stock control is bound to multiple VINs; no inventory was emitted",
          );
      }
    }
    const result = transformSandwRecord(record);
    if (result.status === "rejected") {
      accounting.recordsRejected++;
      for (const value of result.observedVins) observed.add(value);
      continue;
    }
    const vehicle = result.vehicle;
    const values = metadata.get(vehicle.vin) ?? {
      color: new Set<string>(),
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
      row: new Set<string>(),
    };
    for (const key of optionalKeys)
      if (vehicle[key] !== null) values[key].add(vehicle[key]);
    metadata.set(vehicle.vin, values);
    if (vehicles.has(vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(vehicle.vin, vehicle);
  }
  for (const [vin, vehicle] of vehicles) {
    const values = metadata.get(vin);
    if (!values)
      throw new Error("S&W accepted donor lost optional metadata accounting");
    for (const key of optionalKeys)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed],
    accounting,
  };
}

export function validateSandwSnapshot(
  snapshot: ReturnType<typeof sandwSnapshot>,
  previous: number | null,
): void {
  const { accounting: a, vehicles } = snapshot;
  if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
    throw new Error(
      "S&W previous complete count must be null or a nonnegative integer",
    );
  if (
    a.recordsProcessed !==
      vehicles.length + a.recordsRejected + a.duplicateVehicles ||
    vehicles.length < SANDW_MINIMUM_UNIQUE_INVENTORY ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      vehicles.length <
        previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      "S&W complete census failed reconciliation, the 500-donor floor, 10% rejection, 25% duplicate or 50% previous-count guard; prior inventory is preserved",
    );
}
