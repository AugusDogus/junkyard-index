import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  type OemgarageCatalog,
  type OemgarageRecord,
} from "./oemgarage-parser";
import { OEMGARAGE_YARD } from "./oemgarage-yard-metadata";

export type OemgarageVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "oemgarage";
};
const optional = (raw: string | undefined): string | null => {
  const value = raw?.trim() ?? "";
  return value &&
    value.length <= 200 &&
    !/^(?:unknown|none|null|n\/?a|[-?]+)$/i.test(value)
    ? value
    : null;
};
function date(raw: string | undefined): string | null {
  const match =
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01]), (\d{4})$/.exec(
      raw ?? "",
    );
  if (!match) return null;
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ].indexOf(match[1] ?? "");
  const value = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
  return value.getUTCFullYear() === Number(match[3]) &&
    value.getUTCMonth() === month &&
    value.getUTCDate() === Number(match[2])
    ? value.toISOString().slice(0, 10)
    : null;
}
function image(record: OemgarageRecord): string | null {
  const u = record.imageUrl ? URL.parse(record.imageUrl) : null;
  return u &&
    u.protocol === "https:" &&
    u.hostname === "cdn.shopify.com" &&
    !u.username &&
    !u.password &&
    !u.hash &&
    new RegExp(
      "^/s/files/1/0538/3910/2142/files/donor-" +
        record.card.id +
        "-car[1-9]\\d*\\.(?:jpg|jpeg|png|webp)$",
      "i",
    ).test(u.pathname) &&
    /^\?v=\d+$/.test(u.search)
    ? u.href
    : null;
}
export function assessOemgarageRecord(record: OemgarageRecord) {
  const match =
    /^(\d{4})\s+(Mercedes-Benz|Land Rover|BMW|Audi|Mini|Porsche)\s+(.+)$/i.exec(
      record.header,
    );
  const year = Number(match?.[1]),
    make = normalizeCanonicalMake(match?.[2] ?? "");
  // Chassis is separately published native metadata. Remove only its exact
  // parenthesized suffix, never decode YMM from a VIN or rearrange a heading.
  const suffix = record.fields.Series ? " (" + record.fields.Series + ")" : "";
  const rawModel = match?.[3] ?? "";
  const model =
    suffix && rawModel.endsWith(suffix)
      ? rawModel.slice(0, -suffix.length)
      : rawModel;
  const stockSuffix = " \u2014 Stock #" + record.stock;
  const cardHeading = record.title.endsWith(stockSuffix)
    ? record.title.slice(0, -stockSuffix.length)
    : "";
  const withoutSeries = (value: string) =>
    suffix && value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
  const vin = inventoryVin(record.fields.VIN ?? "", match?.[1] ?? "");
  const reasons: string[] = [];
  if (
    !match ||
    year < 1886 ||
    year > new Date().getUTCFullYear() + 1 ||
    !make ||
    !optional(model)
  )
    reasons.push("missing-or-invalid-explicit-native-year-make-model");
  if (!vin) reasons.push("missing-or-invalid-native-identity");
  if (
    record.title !== record.card.title ||
    withoutSeries(cardHeading) !== withoutSeries(record.header) ||
    record.stock !== record.card.id
  )
    reasons.push("conflicting-native-title-stock-or-donor-join");
  const signature = JSON.stringify([year, make, model]);
  if (reasons.length || !vin)
    return { status: "rejected" as const, record, vin, signature, reasons };
  const vehicle: OemgarageVehicle = {
    source: "oemgarage",
    vin,
    year,
    make,
    model,
    stockNumber: record.stock,
    color: normalizeCanonicalColor(optional(record.fields["Exterior color"])),
    imageUrl: image(record),
    availableDate: date(record.fields.Arrived),
    engine: optional(record.fields.Engine),
    transmission: optional(record.fields.Transmission),
    trim: null,
    locationCode: OEMGARAGE_YARD.code,
    locationName: OEMGARAGE_YARD.name,
    locationCity: OEMGARAGE_YARD.city,
    state: "Florida",
    stateAbbr: "FL",
    lat: OEMGARAGE_YARD.lat,
    lng: OEMGARAGE_YARD.lng,
    section: null,
    row: null,
    space: null,
    detailsUrl: record.card.url,
    partsUrl: null,
    pricesUrl: null,
  };
  return {
    status: "available" as const,
    record,
    vin,
    signature,
    reasons,
    vehicle,
  };
}
export function oemgarageSnapshot(
  catalog: OemgarageCatalog,
  records: readonly OemgarageRecord[],
) {
  if (
    catalog.cards.length !== records.length ||
    records.some(
      (r, i) => JSON.stringify(r.card) !== JSON.stringify(catalog.cards[i]),
    )
  )
    throw new Error(
      "oeM Garage snapshot is not the complete ordered native donor frontier",
    );
  const assessments = records.map(assessOemgarageRecord),
    claims = new Map<string, Set<string>>();
  for (const a of assessments)
    if (a.vin) {
      const values = claims.get(a.vin) ?? new Set<string>();
      values.add(a.signature);
      claims.set(a.vin, values);
    }
  const conflicts = new Set(
    [...claims].filter(([, values]) => values.size > 1).map(([vin]) => vin),
  );
  const vehicles = new Map<string, OemgarageVehicle>();
  const rejected: { id: string; reasons: string[] }[] = [];
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const a of assessments) {
    if (a.status === "rejected" || (a.vin !== null && conflicts.has(a.vin))) {
      accounting.recordsRejected++;
      rejected.push({
        id: a.record.card.id,
        reasons: [
          ...a.reasons,
          ...(a.vin && conflicts.has(a.vin)
            ? ["conflicting-native-required-claims"]
            : []),
        ],
      });
    } else if (vehicles.has(a.vehicle.vin)) accounting.duplicateVehicles++;
    else vehicles.set(a.vehicle.vin, a.vehicle);
  }
  return {
    vehicles: [...vehicles.values()],
    accounting,
    rejected,
    conflictingVins: [...conflicts].sort(),
    observedVins: [...claims.keys()].sort(),
  };
}
export function validateOemgarageSnapshot(
  snapshot: ReturnType<typeof oemgarageSnapshot>,
  previous: number | null = null,
): void {
  const a = snapshot.accounting,
    n = snapshot.vehicles.length;
  if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
    throw new Error(
      "oeM Garage previous complete count must be nonnegative or null",
    );
  if (
    n < 200 ||
    a.recordsProcessed !== n + a.recordsRejected + a.duplicateVehicles ||
    a.recordsExcluded !== 0 ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      n < previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      "oeM Garage complete donor census failed the 200-donor floor, rejection, duplicate, reconciliation or previous-count guards; prior inventory is preserved",
    );
}
