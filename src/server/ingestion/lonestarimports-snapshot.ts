import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import { vinplusCalendarDate, vinplusOptionalText } from "./vinplus-protocol";
import type { LonestarimportsRecord } from "./lonestarimports-parser";
import {
  LONESTARIMPORTS_MINIMUM_INVENTORY,
  LONESTARIMPORTS_ORIGIN,
  LONESTARIMPORTS_YARD,
} from "./lonestarimports-yard-metadata";

export type LonestarimportsVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "lonestarimports";
};
export function lonestarimportsInactive(row: LonestarimportsRecord): boolean {
  const description = row.Description?.trim().toUpperCase() ?? "";
  return (
    /\bCRUSH(?:ED)?\b/.test(description) ||
    /^SOLD\b/.test(description) ||
    /(?:^|[,\s])-SOLD-+(?:$|\s)/.test(description) ||
    /\bVIN#\s+[A-Z0-9]{5,17}\s+SOLD\s*\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(
      description,
    )
  );
}
function make(row: LonestarimportsRecord): string | null {
  const native = vinplusOptionalText(row.Manufacturer)?.toUpperCase();
  if (!native) return null;
  const aliases: Record<string, string> = {
    "BAVARIAN MOTOR WORKS (BMW)": "BMW",
    "MASERATI MOTORS": "Maserati",
    "M G": "MG",
  };
  if (aliases[native]) return aliases[native];
  // These are source category labels, not makes. Read only the explicit native
  // vehicle label, never a VIN decoder, stock number or model-code dictionary.
  if (
    [
      "EXOTIC VEHICLES",
      "MISC DOMESTIC LRG TRUCKS",
      "GM TRUCKS",
      "CHEVROLET GEO",
    ].includes(native)
  ) {
    for (const label of [row.Make, row.ModelLong]) {
      const literal = label?.trim().toUpperCase() ?? "";
      if (/^CHEVY GEO\s/.test(literal)) return "Geo";
      const prefix =
        /^(BENTLEY|LAMBORGHINI|FREIGHTLINER|CHEVROLET|CHEVY|GMC|GEO)(?:\s|$)/.exec(
          literal,
        );
      if (prefix?.[1])
        return prefix[1] === "CHEVY"
          ? "Chevrolet"
          : normalizeCanonicalMake(prefix[1]);
    }
    return null;
  }
  if (/UNKNOWN|MISC|EXOTIC|OTHER|^0+$/.test(native)) return null;
  return normalizeCanonicalMake(native.replace(/ TRUCKS?$/, ""));
}
function date(raw: string | null): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T00:00:00$/.exec(raw ?? "");
  return match
    ? vinplusCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}
const guidPattern = /^[A-F0-9]{8}(?:-[A-F0-9]{4}){3}-[A-F0-9]{12}$/i;
export function lonestarimportsSnapshot(
  rows: readonly LonestarimportsRecord[],
  previousAcceptedCount: number | null,
) {
  const groups = new Map<
    string,
    { required: Set<string>; stocks: Set<string>; guids: Set<string> }
  >();
  const stockOwners = new Map<string, Set<string>>();
  const guidOwners = new Map<string, Set<string>>();
  for (const row of rows) {
    const vin = inventoryVin(row.VIN ?? "", String(row.Yr ?? ""));
    if (!vin) continue;
    const group = groups.get(vin) ?? {
      required: new Set<string>(),
      stocks: new Set<string>(),
      guids: new Set<string>(),
    };
    group.required.add(
      JSON.stringify([
        row.Yr,
        make(row),
        row.Model,
        row.ModelLong,
        lonestarimportsInactive(row),
      ]),
    );
    if (row.Stock) {
      group.stocks.add(row.Stock);
      stockOwners.set(
        row.Stock,
        new Set([...(stockOwners.get(row.Stock) ?? []), vin]),
      );
    }
    if (row.GUID) {
      group.guids.add(row.GUID);
      guidOwners.set(
        row.GUID,
        new Set([...(guidOwners.get(row.GUID) ?? []), vin]),
      );
    }
    groups.set(vin, group);
  }
  const conflicts = new Set(
    [...groups]
      .filter(
        ([, group]) =>
          group.required.size > 1 ||
          group.stocks.size > 1 ||
          group.guids.size > 1 ||
          [...group.stocks].some((s) => (stockOwners.get(s)?.size ?? 0) > 1) ||
          [...group.guids].some((g) => (guidOwners.get(g)?.size ?? 0) > 1),
      )
      .map(([vin]) => vin),
  );
  const vehicles = new Map<string, LonestarimportsVehicle>();
  const observedVins = new Set<string>();
  const rejected: LonestarimportsRecord[] = [];
  const excluded: LonestarimportsRecord[] = [];
  const errors: string[] = [];
  const accounting = {
    recordsProcessed: rows.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const row of rows) {
    const vin = inventoryVin(row.VIN ?? "", String(row.Yr ?? ""));
    if (row.Stock && !/^LS\d{1,7}$/.test(row.Stock))
      errors.push(
        "Lonestar native own-stock namespace changed; review ownership before staging",
      );
    if (
      row.PrimaryImageId &&
      row.GUID &&
      !row.PrimaryImageId.toUpperCase().startsWith(
        row.GUID.toUpperCase() + "||",
      )
    )
      errors.push(
        "Lonestar native image points to a different donor GUID; do not discard ownership evidence",
      );
    if (lonestarimportsInactive(row) && !(vin && conflicts.has(vin))) {
      accounting.recordsExcluded++;
      excluded.push(row);
      continue;
    }
    const manufacturer = make(row),
      model =
        vinplusOptionalText(row.ModelLong) ?? vinplusOptionalText(row.Model);
    if (
      !vin ||
      row.Yr === null ||
      row.Yr < 1886 ||
      row.Yr > 2100 ||
      !manufacturer ||
      !model ||
      !vinplusOptionalText(row.Make) ||
      !row.Stock ||
      !/^LS\d{1,7}$/.test(row.Stock) ||
      !row.GUID ||
      !guidPattern.test(row.GUID) ||
      row.Model === null ||
      row.Manufacturer === null ||
      !vinplusOptionalText(row.Model) ||
      !vinplusOptionalText(row.Manufacturer) ||
      conflicts.has(vin)
    ) {
      accounting.recordsRejected++;
      rejected.push(row);
      if (vin) observedVins.add(vin);
      continue;
    }
    const image =
      row.PrimaryImageId &&
      new RegExp(`^${row.GUID}\\|\\|[1-9]\\d{0,5}$`, "i").test(
        row.PrimaryImageId,
      )
        ? `${LONESTARIMPORTS_ORIGIN}/api/image-cache/${encodeURIComponent(row.PrimaryImageId)}`
        : null;
    const optional = { imageUrl: image, availableDate: date(row.DateEntered) };
    const old = vehicles.get(vin);
    if (old) {
      accounting.duplicateVehicles++;
      for (const field of ["imageUrl", "availableDate"] as const)
        if (old[field] !== optional[field]) old[field] = null;
      continue;
    }
    const parts = new URLSearchParams({
      make: row.Manufacturer,
      model: row.Model,
      yr: String(row.Yr),
      stock: row.Stock,
    });
    vehicles.set(vin, {
      source: "lonestarimports",
      vin,
      year: row.Yr,
      make: manufacturer,
      model,
      stockNumber: row.Stock,
      ...optional,
      color: null,
      row: null,
      section: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
      locationCode: LONESTARIMPORTS_YARD.code,
      locationName: LONESTARIMPORTS_YARD.name,
      locationCity: LONESTARIMPORTS_YARD.city,
      state: "Texas",
      stateAbbr: "TX",
      lat: LONESTARIMPORTS_YARD.lat,
      lng: LONESTARIMPORTS_YARD.lng,
      detailsUrl: `${LONESTARIMPORTS_ORIGIN}/new-arrivals?${new URLSearchParams({ stock: row.Stock })}`,
      partsUrl: `${LONESTARIMPORTS_ORIGIN}/parts?${parts}`,
      pricesUrl: null,
    });
  }
  const active = accounting.recordsProcessed - accounting.recordsExcluded;
  if (vehicles.size < LONESTARIMPORTS_MINIMUM_INVENTORY)
    errors.push("Lonestar accepted inventory is below fixed source floor843");
  if (
    !active ||
    accounting.recordsRejected / active >
      SourceValidationPolicy.maximumRejectionRatio
  )
    errors.push("Lonestar active rejection ratio exceeds10%");
  if (
    !active ||
    accounting.duplicateVehicles / active >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    errors.push("Lonestar active duplicate ratio exceeds25%");
  if (
    previousAcceptedCount !== null &&
    (!Number.isSafeInteger(previousAcceptedCount) ||
      previousAcceptedCount < 0 ||
      vehicles.size <
        Math.floor(
          previousAcceptedCount *
            SourceValidationPolicy.minimumPreviousRunRatio,
        ))
  )
    errors.push("Lonestar prior accepted inventory drift exceeds50%");
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    rejected,
    excluded,
    accounting,
    errors: [...new Set(errors)],
  };
}
