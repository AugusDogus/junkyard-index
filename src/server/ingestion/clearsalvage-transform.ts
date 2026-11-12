import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { ClearsalvageRecord } from "./clearsalvage-parser";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import { CLEARSALVAGE_YARD } from "./clearsalvage-yard-metadata";

export type ClearsalvageCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "clearsalvage";
};
const missing = (value: string) =>
  /^(?:unknown|other|none|null|n\/?a|-)?$/i.test(value);
const comparison = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();
function scalar(values: readonly string[]): string | null {
  const unique = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return unique.length === 1 && unique[0] !== undefined && !missing(unique[0])
    ? unique[0]
    : null;
}
export function clearsalvageRecordVins(record: ClearsalvageRecord): string[] {
  return [
    ...new Set(
      record.claims.vin.flatMap((raw) => {
        const vin = inventoryVin(raw, scalar(record.claims.year) ?? "");
        return vin ? [vin] : [];
      }),
    ),
  ];
}
export function transformClearsalvageRecord(
  record: ClearsalvageRecord,
):
  | { status: "available"; vehicle: ClearsalvageCanonicalVehicle }
  | { status: "incomplete"; observedVins: string[] } {
  const observedVins = clearsalvageRecordVins(record);
  const year = scalar(record.claims.year),
    make = scalar(record.claims.make),
    model = scalar(record.claims.model),
    rawVin = scalar(record.claims.vin);
  const vin = observedVins[0];
  // A title merely repeating the dedicated model provides no distinct maker assertion.
  if (
    !year ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !make ||
    !model ||
    comparison(make) === comparison(model) ||
    comparison(make) !== comparison(record.post.title) ||
    !rawVin ||
    observedVins.length !== 1 ||
    inventoryVin(rawVin, year) !== vin ||
    !vin
  )
    return { status: "incomplete", observedVins };
  return {
    status: "available",
    vehicle: {
      source: "clearsalvage",
      vin,
      year: Number(year),
      make: normalizeCanonicalMake(make),
      model,
      stockNumber: scalar(record.claims.stock),
      color: null,
      imageUrl: null,
      availableDate: null,
      locationCode: CLEARSALVAGE_YARD.code,
      locationName: CLEARSALVAGE_YARD.name,
      locationCity: CLEARSALVAGE_YARD.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: CLEARSALVAGE_YARD.lat,
      lng: CLEARSALVAGE_YARD.lng,
      detailsUrl: record.post.url,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}

export function clearsalvageSnapshot(records: readonly ClearsalvageRecord[]) {
  const urls = new Set<string>(),
    ids = new Set<number>();
  const groups = new Map<string, ClearsalvageRecord[]>();
  const quarantined = new Set<number>();
  for (const record of records) {
    if (urls.has(record.post.url) || ids.has(record.post.id))
      throw new Error(
        "Clear Salvage native donor post or destination repeats; retain prior inventory and inspect the roster",
      );
    urls.add(record.post.url);
    ids.add(record.post.id);
    for (const vin of clearsalvageRecordVins(record))
      groups.set(vin, [...(groups.get(vin) ?? []), record]);
  }
  for (const group of groups.values()) {
    if (
      ["year", "make", "model"].some((field) => {
        const values = group
          .flatMap((record) =>
            field === "year"
              ? record.claims.year
              : field === "make"
                ? record.claims.make
                : record.claims.model,
          )
          .map(comparison)
          .filter((value) => value && !missing(value));
        return new Set(values).size > 1;
      })
    )
      group.forEach((record) => quarantined.add(record.post.id));
  }
  const vehicles = new Map<string, ClearsalvageCanonicalVehicle>();
  const observed = new Set<string>();
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const record of records) {
    const result = transformClearsalvageRecord(record);
    if (result.status === "incomplete" || quarantined.has(record.post.id)) {
      accounting.recordsRejected++;
      clearsalvageRecordVins(record).forEach((vin) => observed.add(vin));
      continue;
    }
    const previous = vehicles.get(result.vehicle.vin);
    if (previous) {
      accounting.duplicateVehicles++;
      vehicles.set(result.vehicle.vin, {
        ...previous,
        stockNumber:
          previous.stockNumber === result.vehicle.stockNumber
            ? previous.stockNumber
            : null,
      });
    } else vehicles.set(result.vehicle.vin, result.vehicle);
  }
  // An incomplete occurrence cannot silently coexist with an emitted winner.
  for (const vin of observed) {
    if (vehicles.has(vin))
      throw new Error(
        "Clear Salvage rejected valid VIN also has an eligible occurrence; inspect every required native claim",
      );
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observed],
    accounting,
  };
}
export function validateClearsalvageSnapshot(
  snapshot: ReturnType<typeof clearsalvageSnapshot>,
) {
  const total = snapshot.accounting.recordsProcessed;
  if (
    !snapshot.vehicles.length ||
    snapshot.accounting.recordsRejected / total >
      SourceValidationPolicy.maximumRejectionRatio ||
    snapshot.accounting.duplicateVehicles / total >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "Clear Salvage complete source exceeds the unchanged 10% rejection or 25% duplicate limit, or has no accepted donor; prior inventory is preserved",
    );
}
