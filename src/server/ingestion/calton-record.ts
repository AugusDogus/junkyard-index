import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { caltonOwnedUrl, caltonText } from "./calton-html";

export const CaltonControlSchema = z
  .object({
    path: z.string().max(500),
    literal: z.string().max(1000),
    label: z.string().min(1).max(200),
    count: z.number().int().nonnegative().safe(),
  })
  .strict();
export type CaltonControl = z.infer<typeof CaltonControlSchema>;
export const CaltonContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("model"),
      sourceUrl: z.string(),
      make: CaltonControlSchema,
      model: CaltonControlSchema,
    })
    .strict(),
  z.object({ kind: z.literal("arrivals"), sourceUrl: z.string() }).strict(),
]);
export type CaltonContext = z.infer<typeof CaltonContextSchema>;
export const CaltonRecordSchema = z
  .object({
    sourceUrl: z.string(),
    context: CaltonContextSchema,
    ordinal: z.number().int().nonnegative(),
    cardId: z.string().nullable(),
    years: z.array(z.string()),
    titles: z.array(z.string()),
    vins: z.array(z.string()),
    fields: z.array(
      z.object({ label: z.string(), value: z.string() }).strict(),
    ),
    destinations: z.array(
      z
        .object({ literal: z.string().nullable(), url: z.string().nullable() })
        .strict(),
    ),
    images: z.array(z.string().nullable()),
  })
  .strict();
export type CaltonRecord = z.infer<typeof CaltonRecordSchema>;
export interface CaltonCandidate {
  vin: string;
  year: number;
  make: string;
  model: string;
  detailsUrl: string;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  color: string | null;
  row: string | null;
  mileage: number | null;
}
type CaltonEvidence = {
  record: CaltonRecord;
  validVinClaims: string[];
  reasons: string[];
};
export type CaltonAssessment = CaltonEvidence &
  (
    | { status: "required-pass"; candidate: CaltonCandidate }
    | {
        status: "required-reject" | "identity-conflict" | "boundary-unknown";
        candidate: null;
      }
  );
const distinct = (values: readonly string[]) => [
  ...new Set(values.map((value) => value.trim())),
];
const one = (values: readonly string[]) => {
  const unique = distinct(values);
  return unique.length === 1 ? (unique[0] ?? "") : "";
};
const usable = (value: string) =>
  /[a-z0-9]/i.test(value) &&
  !/^(?:unknown|other|n\/?a|none|null|undefined|[-?]+)$/i.test(value);
const optional = (values: readonly string[]) =>
  one(values.filter((value) => usable(value))) || null;

// Native menus and donor links use two different ampersand slug encoders.
// Preserve both published literals; no other parent spelling is equivalent.
const donorParentAliases = new Map([
  ["/parts/CHRYSLER/TOWN_-and_COUNTRY", "/parts/CHRYSLER/TOWN_and__COUNTRY"],
  [
    "/parts/LINCOLN/LINCOLN_-and_TOWN_CAR",
    "/parts/LINCOLN/LINCOLN_and__TOWN_CAR",
  ],
]);
/** Donor destination parents that bind to a published model path. */
export const caltonDonorParents = (modelPath: string) => {
  const alias = donorParentAliases.get(modelPath);
  return alias ? [modelPath, alias] : [modelPath];
};
function stockSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function assess(
  record: CaltonRecord,
  nativeMakes: readonly string[],
): CaltonAssessment {
  const yearRaw = one(record.years),
    title = one(record.titles),
    vinRaw = one(record.vins);
  const fields = (label: string) =>
    record.fields
      .filter((field) => field.label === label)
      .map((field) => field.value);
  const reasons: string[] = [];
  const conflict = [record.years, record.titles, record.vins].some(
    (claims) =>
      distinct(claims.filter(Boolean).map((claim) => claim.toUpperCase()))
        .length > 1,
  );
  if (conflict) reasons.push("conflicting-native-required-claims");
  const year =
    /^\d{4}$/.test(yearRaw) &&
    Number(yearRaw) >= 1886 &&
    Number(yearRaw) <= new Date().getUTCFullYear() + 1
      ? Number(yearRaw)
      : null;
  const vin = inventoryVin(vinRaw, yearRaw);
  const make =
    record.context.kind === "model"
      ? record.context.make.label
      : ([...nativeMakes]
          .sort((a, b) => b.length - a.length)
          .find((make) => title.startsWith(make + " ")) ?? "");
  const model = title.startsWith(make + " ")
    ? title.slice(make.length + 1).trim()
    : "";
  if (year === null) reasons.push("missing-or-invalid-native-year");
  if (vin === null) reasons.push("missing-or-invalid-native-vin");
  if (!usable(make) || !usable(model))
    reasons.push("missing-or-unresolved-native-make-model");
  if (
    record.context.kind === "model" &&
    usable(title) &&
    title !== `${make} ${record.context.model.label}` &&
    !(
      record.context.model.label.startsWith(make + " ") &&
      title === record.context.model.label
    )
  )
    reasons.push("native-title-and-published-model-conflict");
  const urls = record.destinations.map(({ literal }) =>
    literal === null
      ? null
      : caltonOwnedUrl(caltonText(literal), record.sourceUrl),
  );
  const destinations = distinct(urls.flatMap((url) => (url ? [url.href] : [])));
  const destination = urls[0];
  const parts = destination?.pathname.split("/") ?? [];
  const boundary =
    !urls.length ||
    urls.some(
      (url) =>
        !url || !/^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname),
    );
  if (boundary) reasons.push("missing-or-foreign-native-donor-destination");
  if (destinations.length > 1)
    reasons.push("conflicting-native-donor-destinations");
  const donorParent = parts.slice(0, 4).join("/");
  if (
    destination &&
    record.context.kind === "model" &&
    !caltonDonorParents(record.context.model.path).includes(donorParent)
  )
    reasons.push("native-donor-destination-parent-conflict");
  if (destination && yearRaw && parts[5] !== yearRaw)
    reasons.push("native-year-and-destination-conflict");
  const stock = optional(fields("stock"));
  if (
    destination &&
    [stock, record.cardId].some(
      (value) =>
        value && usable(value) && value !== stockSegment(parts[4] ?? ""),
    )
  )
    reasons.push("native-stock-and-destination-conflict");
  const validVinClaims = [
    ...new Set(
      record.vins.flatMap((claim) =>
        ["", ...record.years].flatMap((year) => {
          const value = inventoryVin(claim, year);
          return value === null ? [] : [value];
        }),
      ),
    ),
  ];
  const evidence = { record, validVinClaims, reasons };
  if (boundary)
    return { ...evidence, status: "boundary-unknown", candidate: null };
  if (conflict || reasons.some((reason) => reason.includes("conflict")))
    return { ...evidence, status: "identity-conflict", candidate: null };
  if (reasons.length || vin === null || year === null || !destination)
    return { ...evidence, status: "required-reject", candidate: null };
  const date = optional(fields("enter date"));
  const availableDate =
    date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
      ? date
      : null;
  const mileageRaw = optional(fields("miles"));
  const mileage =
    mileageRaw &&
    /^\d+$/.test(mileageRaw) &&
    Number.isSafeInteger(Number(mileageRaw))
      ? Number(mileageRaw)
      : null;
  const imageUrl = optional(
    record.images.flatMap((raw) => {
      const url = raw === null ? null : URL.parse(raw);
      return url &&
        url.origin === "https://da8h1v3w8q6n5.cloudfront.net" &&
        url.pathname.startsWith("/mm28/images/") &&
        !url.search &&
        !url.hash &&
        /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
        ? [url.href]
        : [];
    }),
  );
  return {
    ...evidence,
    status: "required-pass",
    candidate: {
      vin,
      year,
      make,
      model,
      detailsUrl: destination.href,
      stockNumber: stock,
      imageUrl,
      availableDate,
      mileage,
      color: null,
      row: null,
    },
  };
}
/** Raw required claims and every appearance survive until whole-graph quality review. */
export const CaltonRecord = { schema: CaltonRecordSchema, assess } as const;
