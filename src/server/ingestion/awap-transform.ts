import type { ConnectorChunkAccounting } from "./connector-chunk";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { AwapRecord } from "./awap-parser";
import { AWAP_YARD } from "./awap-yard-metadata";

export type AwapCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "awap";
};
const missing = (raw: string) =>
  /^(?:unknown|other|n\/?a|null|none|not specified|not available|-)?$/i.test(
    raw.trim(),
  );
export function transformAwapRecord(
  record: AwapRecord,
):
  | { status: "available"; vehicle: AwapCanonicalVehicle }
  | { status: "incomplete"; observedVins: string[] } {
  const observedVins = [
    ...new Set(
      record.vinClaims
        .map((raw) => inventoryVin(raw, record.year))
        .filter((vin) => vin !== null),
    ),
  ];
  const claims = new Set(
    record.vinClaims.map((raw) => raw.trim().toUpperCase()).filter(Boolean),
  );
  if (claims.size > 1)
    throw new Error(
      "AWAP same-card native VIN controls contradict; inspect the complete source before retrying",
    );
  const vin = observedVins[0];
  const make = normalizeCanonicalMake(record.make);
  const completeYmm =
    /^\d{4}$/.test(record.year) &&
    Number(record.year) >= 1886 &&
    Number(record.year) <= 2100 &&
    !missing(make) &&
    !missing(record.make) &&
    !missing(record.model);
  if (
    completeYmm &&
    record.title.toUpperCase() !==
      `${record.year} ${record.make} ${record.model}`.toUpperCase()
  )
    throw new Error(
      "AWAP native title contradicts explicit year, make or model; inspect the complete source before retrying",
    );
  if (
    !completeYmm ||
    !vin ||
    record.vinClaims.length !== 2 ||
    record.vinClaims.some((raw) => inventoryVin(raw, record.year) !== vin)
  )
    return { status: "incomplete", observedVins };
  return {
    status: "available",
    vehicle: {
      source: "awap",
      vin,
      year: Number(record.year),
      make,
      model: record.model,
      locationCode: AWAP_YARD.code,
      locationName: AWAP_YARD.name,
      locationCity: AWAP_YARD.city,
      state: "Alabama",
      stateAbbr: "AL",
      lat: AWAP_YARD.lat,
      lng: AWAP_YARD.lng,
      detailsUrl: record.detailsUrl,
      color: record.color,
      imageUrl: record.imageUrl,
      engine: record.engine,
      transmission: record.transmission,
      // Native SKU and CMS/upload dates have no established yard-stock/arrival semantics.
      stockNumber: null,
      availableDate: null,
      row: null,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      trim: null,
    },
  };
}
export function awapSnapshot(records: readonly AwapRecord[]) {
  const vehicles: AwapCanonicalVehicle[] = [];
  const observed = new Set<string>();
  const vins = new Set<string>();
  const urls = new Set<string>();
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const record of records) {
    if (urls.has(record.detailsUrl))
      throw new Error("AWAP catalog repeats a donor destination");
    urls.add(record.detailsUrl);
    const result = transformAwapRecord(record);
    const identities =
      result.status === "available"
        ? [result.vehicle.vin]
        : result.observedVins;
    for (const vin of identities) {
      if (vins.has(vin))
        throw new Error(
          "AWAP different donor controls reuse a valid VIN or serial",
        );
      vins.add(vin);
    }
    if (result.status === "available") vehicles.push(result.vehicle);
    else {
      accounting.recordsRejected++;
      for (const vin of result.observedVins) observed.add(vin);
    }
  }
  return { vehicles, observedVins: [...observed], accounting };
}
export function validateAwapSnapshot(
  snapshot: ReturnType<typeof awapSnapshot>,
): void {
  if (
    snapshot.vehicles.length === 0 ||
    snapshot.accounting.recordsRejected / snapshot.accounting.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio
  )
    throw new Error(
      "AWAP yard has no valid donors or exceeds the unchanged 10% required-field rejection limit; prior inventory is preserved",
    );
}
