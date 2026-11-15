import { z } from "zod";
import type { CanonicalVehicle } from "./types";
import { normalizeCanonicalMake } from "./normalization";
import { NorthwestRecord, type NorthwestAssessment } from "./northwest-record";

export type NorthwestCandidate = Omit<CanonicalVehicle, "source"> & {
  source: "northwest";
};
export const NorthwestLocationSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    city: z.string().min(1),
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  })
  .strict();
export type NorthwestLocation = z.infer<typeof NorthwestLocationSchema>;
export const NorthwestOptionalFields = [
  ["stockNumber", "stockNumbers"],
  ["imageUrl", "imageUrls"],
  ["availableDate", "availableDates"],
  ["color", "colors"],
  ["section", "sections"],
  ["row", "rows"],
  ["space", "spaces"],
] as const;
export type NorthwestOptionalField =
  (typeof NorthwestOptionalFields)[number][0];
export interface NorthwestOptionalConflict {
  field: NorthwestOptionalField;
  values: string[];
}
export type NorthwestRecordResult =
  | {
      status: "rejected";
      assessment: Extract<NorthwestAssessment, { status: "required-reject" }>;
      candidate: null;
    }
  | {
      status: "candidate";
      assessment: Extract<NorthwestAssessment, { status: "required-pass" }>;
      candidate: NorthwestCandidate;
      optionalConflicts: NorthwestOptionalConflict[];
    };

export function northwestOptionalValue(
  field: NorthwestOptionalField,
  value: string | null,
  sourceUrl: string,
): string | null {
  if (
    value === null ||
    !value.trim() ||
    value.length > 2000 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /^(?:unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(value)
  )
    return null;
  if (field === "imageUrl") {
    const url = URL.parse(value, sourceUrl);
    return url &&
      url.origin === "https://northwestautoparts.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      ? url.href
      : null;
  }
  if (field === "availableDate") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value
      ? value
      : null;
  }
  return value.length <= 100 ? value : null;
}

/** Display normalization belongs after whole-occurrence native conflict review. */
export function transformNorthwestRecord(
  record: NorthwestRecord,
  location: NorthwestLocation,
): NorthwestRecordResult {
  const assessment = NorthwestRecord.assess(record);
  if (assessment.status === "required-reject")
    return { status: "rejected", assessment, candidate: null };
  const { identity } = assessment;
  const candidate: NorthwestCandidate = {
    source: "northwest",
    vin: identity.vin,
    year: identity.year,
    make: normalizeCanonicalMake(identity.make),
    model: identity.model,
    locationCode: location.code,
    locationName: location.name,
    locationCity: location.city,
    lat: location.lat,
    lng: location.lng,
    state: "Alaska",
    stateAbbr: "AK",
    detailsUrl: identity.destination,
    partsUrl: null,
    pricesUrl: null,
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    color: null,
    section: null,
    row: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
  const optionalConflicts: NorthwestOptionalConflict[] = [];
  for (const [field, claims] of NorthwestOptionalFields) {
    const values = [...new Set(record[claims].filter((value) => value.trim()))];
    if (values.length > 1) optionalConflicts.push({ field, values });
    candidate[field] = northwestOptionalValue(
      field,
      values.length === 1 ? (values[0] ?? null) : null,
      record.sourceUrl,
    );
  }
  return { status: "candidate", assessment, candidate, optionalConflicts };
}
