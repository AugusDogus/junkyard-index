import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { SpeedysRecord } from "./speedys-parser";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import { SPEEDYS_YARD } from "./speedys-yard-metadata";

export type SpeedysCanonicalVehicle = CanonicalVehicle;
const comparison = (value: string) =>
  value.trim().replace(/\s+/g, " ").toUpperCase();
function scalar(values: readonly string[]) {
  const nonempty = values.map((v) => v.trim()).filter(Boolean);
  const first = nonempty[0];
  return first &&
    !/^(?:unknown|other|n\/?a|none|null|-)$/i.test(first) &&
    nonempty.every((v) => comparison(v) === comparison(first))
    ? first
    : null;
}
export function speedysRecordVins(record: SpeedysRecord): string[] {
  return [
    ...new Set(
      record.claims.vin.flatMap((raw) => {
        const vin = inventoryVin(raw, scalar(record.claims.year) ?? "");
        return vin && vin === raw.trim() ? [vin] : [];
      }),
    ),
  ];
}
export function transformSpeedysRecord(
  record: SpeedysRecord,
):
  | { status: "available"; vehicle: SpeedysCanonicalVehicle }
  | { status: "incomplete"; observedVins: string[] } {
  const year = scalar(record.claims.year),
    make = scalar(record.claims.make),
    model = scalar(record.claims.model),
    rawVin = scalar(record.claims.vin);
  const observedVins = speedysRecordVins(record);
  const vin = observedVins[0];
  if (
    !year ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !make ||
    !model ||
    comparison(make) === comparison(model) ||
    !rawVin ||
    !vin ||
    observedVins.length !== 1 ||
    rawVin !== vin
  )
    return { status: "incomplete", observedVins };
  return {
    status: "available",
    vehicle: {
      source: "speedys",
      vin,
      year: Number(year),
      make: normalizeCanonicalMake(make),
      model,
      stockNumber: scalar(record.claims.stock),
      imageUrl: null,
      color: null,
      availableDate: null,
      locationCode: SPEEDYS_YARD.code,
      locationName: SPEEDYS_YARD.name,
      locationCity: SPEEDYS_YARD.city,
      state: "Virginia",
      stateAbbr: "VA",
      lat: SPEEDYS_YARD.lat,
      lng: SPEEDYS_YARD.lng,
      detailsUrl: record.post.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
      section: null,
      row: null,
      space: null,
    },
  };
}
export function speedysSnapshot(records: readonly SpeedysRecord[]) {
  const vehicles = new Map<string, SpeedysCanonicalVehicle>();
  const observedVins = new Set<string>();
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: records.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  for (const record of records) {
    const result = transformSpeedysRecord(record);
    if (result.status === "incomplete") {
      accounting.recordsRejected++;
      result.observedVins.forEach((vin) => observedVins.add(vin));
      continue;
    }
    const prior = vehicles.get(result.vehicle.vin);
    if (prior) {
      if (
        prior.year !== result.vehicle.year ||
        comparison(prior.make) !== comparison(result.vehicle.make) ||
        comparison(prior.model) !== comparison(result.vehicle.model)
      )
        throw new Error(
          "Speedys different donor records conflict on required identity for the same native VIN",
        );
      accounting.duplicateVehicles++;
    } else vehicles.set(result.vehicle.vin, result.vehicle);
  }
  if ([...observedVins].some((vin) => vehicles.has(vin)))
    throw new Error(
      "Speedys rejected native identity also has an eligible occurrence; inspect every conflicting claim",
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    accounting,
  };
}
export function validateSpeedysSnapshot(
  snapshot: ReturnType<typeof speedysSnapshot>,
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
      "Speedys complete roster has no accepted donor or exceeds the unchanged 10% required-field rejection or 25% duplicate limit",
    );
}
