import { inventoryVin } from "./inventory-vin";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { CitymotorsRecord } from "./citymotors-parser";
import { CITYMOTORS_YARD } from "./citymotors-yard-metadata";

export type CitymotorsCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "citymotors";
};
export type CitymotorsRecordResult =
  | { status: "available"; vehicle: CitymotorsCanonicalVehicle }
  | { status: "incomplete"; vins: string[] };
const key = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9]/g, "");
const missing = (raw: string) =>
  !/[a-z0-9]/i.test(raw) ||
  /^(?:unknown|other|none|null|not specified|n\/?a)$/i.test(raw);
const values = (record: CitymotorsRecord, name: string) => [
  ...new Set(
    record.fields.filter(([label]) => label === name).map(([, value]) => value),
  ),
];
const scalar = (record: CitymotorsRecord, name: string): string | null => {
  const list = values(record, name);
  return list.length === 1 && list[0] !== undefined && !missing(list[0])
    ? list[0]
    : null;
};

/** Only reviewed native aliases and trim wording are comparable. Output keeps
 * the primary spelling. In particular, l/I, O/0 and missing digits never match.
 */
function compatibleTitle(
  title: string,
  year: number,
  make: string,
  model: string,
): boolean {
  const makes = [make];
  if (["mercedesbenz", "mbenz"].includes(key(make)))
    makes.push("Mercedes", "Mercedes-Benz", "MB");
  if (key(make) === "ferrary") makes.push("Ferrari");
  const models = [model];
  if (key(make) === "bmw" && key(model) === "m8comp")
    models.push("M8 COMPETITION");
  if (key(make) === "bmw" && ["330i", "x740i"].includes(key(model)))
    models.push(model + " xDrive");
  if (key(make) === "audi" && key(model) === "a6")
    models.push(model + " S-Line");
  if (["mercedesbenz", "mbenz"].includes(key(make)) && key(model) === "glc63s")
    models.push(model + " AMG");
  return (
    makes.some((brand) =>
      models.some(
        (display) => key(title) === key(`${year} ${brand} ${display}`),
      ),
    ) ||
    (key(make) === "chevrolette" &&
      key(model) === "corvette" &&
      key(title) === key(`${year} ${model}`))
  );
}
export function citymotorsRecordVins(record: CitymotorsRecord): string[] {
  const year = /^(\d{4})\b/.exec(record.heading)?.[1] ?? "";
  return [
    ...new Set(
      values(record, "VIN").flatMap((raw) => {
        const vin = inventoryVin(raw, year);
        return vin ? [vin] : [];
      }),
    ),
  ];
}
export function transformCitymotorsRecord(
  record: CitymotorsRecord,
): CitymotorsRecordResult {
  const vins = citymotorsRecordVins(record);
  const rawYear = scalar(record, "Year");
  const yearText = /^(\d{4})(?:\s|$)/.exec(rawYear ?? "")?.[1] ?? "";
  const year = Number(yearText);
  const make = scalar(record, "Manufacturer");
  const model = scalar(record, "Model");
  const vin = scalar(record, "VIN");
  if (
    !make ||
    !model ||
    !vin ||
    vins.length !== 1 ||
    inventoryVin(vin, yearText) !== vins[0] ||
    !yearText ||
    year < 1886 ||
    year > 2100 ||
    (rawYear !== yearText && key(rawYear ?? "") !== key(record.heading)) ||
    key(record.heading) !== key(record.post.title) ||
    !compatibleTitle(record.heading, year, make, model)
  )
    return { status: "incomplete", vins };
  const identity = vins[0];
  if (!identity) return { status: "incomplete", vins };
  return {
    status: "available",
    vehicle: {
      source: "citymotors",
      vin: identity,
      year,
      make,
      model,
      color: scalar(record, "Exterior color"),
      imageUrl: record.post.imageUrl,
      stockNumber: null,
      availableDate: null,
      locationCode: CITYMOTORS_YARD.code,
      locationName: CITYMOTORS_YARD.name,
      locationCity: CITYMOTORS_YARD.city,
      state: "Illinois",
      stateAbbr: "IL",
      lat: CITYMOTORS_YARD.lat,
      lng: CITYMOTORS_YARD.lng,
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
export function citymotorsSnapshot(records: readonly CitymotorsRecord[]) {
  const vehicles = new Map<string, CitymotorsCanonicalVehicle>();
  const rejectedVins = new Set<string>();
  let rejected = 0;
  let duplicates = 0;
  for (const record of records) {
    const result = transformCitymotorsRecord(record);
    if (result.status === "incomplete") {
      rejected++;
      result.vins.forEach((vin) => rejectedVins.add(vin));
      continue;
    }
    const vehicle = result.vehicle;
    const previous = vehicles.get(vehicle.vin);
    if (!previous) {
      vehicles.set(vehicle.vin, vehicle);
      continue;
    }
    if (
      previous.year !== vehicle.year ||
      key(previous.make) !== key(vehicle.make) ||
      key(previous.model) !== key(vehicle.model)
    )
      throw new Error(
        "City Motors repeated VIN has conflicting required YMM; retain prior inventory and inspect every native claim",
      );
    vehicles.set(vehicle.vin, {
      ...previous,
      color: previous.color === vehicle.color ? previous.color : null,
      imageUrl:
        previous.imageUrl === vehicle.imageUrl ? previous.imageUrl : null,
    });
    duplicates++;
  }
  if ([...rejectedVins].some((vin) => vehicles.has(vin)))
    throw new Error(
      "City Motors valid rejected VIN also has an eligible conflicting claim",
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...rejectedVins],
    accounting: {
      recordsProcessed: records.length,
      recordsRejected: rejected,
      recordsExcluded: 0,
      duplicateVehicles: duplicates,
    },
  };
}
export function validateCitymotorsSnapshot(
  snapshot: ReturnType<typeof citymotorsSnapshot>,
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
      "City Motors complete donor quality exceeds the unchanged 10% rejection or 25% duplicate limit, or leaves no valid donor",
    );
}
