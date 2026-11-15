import { z } from "zod";
import { alliedInventoryVin as inventoryVin } from "./allied-vin";
import { alliedOwnedUrl, alliedRouteLabel } from "./allied-html";

export const AlliedControlSchema = z
  .object({
    path: z.string().max(500),
    label: z.string().max(200),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type AlliedControl = z.infer<typeof AlliedControlSchema>;
export const AlliedContextSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("model"),
      make: AlliedControlSchema,
      model: AlliedControlSchema,
    })
    .strict(),
  z.object({ kind: z.literal("arrivals") }).strict(),
]);
export type AlliedContext = z.infer<typeof AlliedContextSchema>;
export const AlliedRecordSchema = z
  .object({
    years: z.array(z.string()),
    titles: z.array(z.string()),
    vins: z.array(z.string()),
    inquiries: z.array(z.string()),
    destinations: z.array(z.string()),
    stock: z.string().nullable(),
    image: z.string().nullable(),
    date: z.string().nullable(),
  })
  .strict();
export type AlliedRecord = z.infer<typeof AlliedRecordSchema>;
export interface AlliedNativeIdentity {
  make: string;
  model: string;
  leaf: string;
}
export interface AlliedAssessment {
  record: AlliedRecord;
  nativeIdentity: AlliedNativeIdentity | null;
  nativeClaims: {
    years: string[];
    makeModels: string[];
    vins: string[];
    destinations: string[];
  };
  validVinClaims: string[];
  vin: string | null;
  year: number | null;
  destination: string | null;
  reasons: string[];
}
const one = (values: readonly string[]) =>
  new Set(values).size === 1 ? (values[0] ?? "") : "";
const usable = (value: string) =>
  /[A-Z0-9]/i.test(value) &&
  !/^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(value);

function assess(
  record: AlliedRecord,
  context: AlliedContext,
  published: readonly { make: AlliedControl; model: AlliedControl }[] = [],
): AlliedAssessment {
  const years = [...record.years],
    vins = [...record.vins];
  const makeModels: string[] = [];
  const rawYear = one(record.years),
    rawVin = one(record.vins),
    title = one(record.titles);
  const destinations = [...new Set(record.destinations)];
  const url =
    destinations.length === 1 ? alliedOwnedUrl(destinations[0] ?? "") : null;
  const parts = url?.pathname.split("/") ?? [];
  const modelPath = parts.slice(0, 4).join("/") + "/";
  const known = published.find(
    (value) =>
      value.model.path.replace(/\/$/, "") === modelPath.replace(/\/$/, ""),
  );
  const publishedParent = published
    .map((value) => value.make.label)
    .sort((left, right) => right.length - left.length)
    .find((label) => title.startsWith(label + " ") || title === label);
  const make =
    context.kind === "model"
      ? context.make.label
      : (known?.make.label ??
        (parts[2] ? alliedRouteLabel(parts[2]) : (publishedParent ?? "")));
  // Arrival labels supply the complete YMM independently. Delimit that label
  // once using its native parent, never fill a missing model from a route token.
  const arrivalLeaf = record.inquiries.includes(
    `${rawYear} ${make} ${title} - VIN ${rawVin}`.trim(),
  )
    ? title
    : title.startsWith(make + " ")
      ? title.slice(make.length).trim()
      : "";
  const leaf =
    context.kind === "model"
      ? context.model.label
      : (known?.model.label ?? arrivalLeaf);
  const full = make + " " + leaf;
  const titleOk =
    title === full ||
    (title === leaf && (leaf === make || leaf.startsWith(make + " ")));
  const model =
    titleOk && title.startsWith(make + " ")
      ? title.slice(make.length).trim()
      : titleOk && title === make && leaf === make
        ? leaf
        : "";
  const identity = usable(make) && usable(model) ? { make, model, leaf } : null;
  // Compare a supplied inquiry even when the labelled title is absent. This
  // normalizes the approved representation only; it never backfills a candidate.
  const inquiryModel =
    identity?.model ??
    (leaf.startsWith(make + " ") ? leaf.slice(make.length).trim() : leaf);
  const inquiryIdentity =
    usable(make) && usable(inquiryModel)
      ? JSON.stringify([make, inquiryModel, leaf])
      : null;
  // Raw unresolved labels remain in the record. Comparing an unknown boundary
  // as typed YMM would invent a contradiction from a missing delimiter.
  const comparableYmm = usable(make) && usable(leaf);
  if (comparableYmm)
    for (const claim of record.titles)
      makeModels.push(
        identity && claim === title
          ? JSON.stringify([make, model, leaf])
          : claim,
      );
  for (const inquiry of record.inquiries) {
    const claim = /^(\d{4})\s+(.*?)\s+-\s+VIN\s*(.*)$/.exec(inquiry);
    if (claim) {
      years.push(claim[1] ?? "");
      vins.push(claim[3] ?? "");
      if (comparableYmm)
        makeModels.push(
          claim[2] === full && inquiryIdentity !== null
            ? inquiryIdentity
            : (claim[2] ?? ""),
        );
    }
    for (const found of inquiry.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi))
      vins.push(found[0]);
  }
  const validVinClaims = [
    ...new Set(
      vins.flatMap((value) => {
        const embedded = [...value.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi)].map(
          (match) => match[0],
        );
        return [value, ...embedded].flatMap((claim) =>
          ["", ...years].flatMap((year) => {
            const vin = inventoryVin(claim, year);
            return vin === null ? [] : [vin];
          }),
        );
      }),
    ),
  ].sort();
  const reasons: string[] = [];
  const year =
    /^\d{4}$/.test(rawYear) &&
    Number(rawYear) >= 1886 &&
    Number(rawYear) <= 2100
      ? Number(rawYear)
      : null;
  const vin = inventoryVin(rawVin, rawYear);
  if (year === null) reasons.push("missing-or-invalid-native-year");
  if (vin === null) reasons.push("missing-or-invalid-native-vin");
  if (!titleOk || !identity || record.titles.some((value) => value !== title))
    reasons.push("native-parent-leaf-title-mismatch");
  if (
    !record.inquiries.length ||
    record.inquiries.some(
      (value) => value !== `${rawYear} ${full} - VIN ${rawVin}`.trim(),
    )
  )
    reasons.push("native-inquiry-identity-mismatch");
  const expectedPath =
    context.kind === "model"
      ? context.model.path.replace(/\/$/, "")
      : modelPath.replace(/\/$/, "");
  if (
    !url ||
    url.search ||
    parts.length !== 6 ||
    parts[1] !== "parts" ||
    !parts[4] ||
    parts[4] !== record.stock ||
    parts[5] !== rawYear ||
    parts.slice(0, 4).join("/") !== expectedPath
  )
    reasons.push("native-donor-destination-missing-conflicting-or-unowned");
  if (
    [years, vins, makeModels].some(
      (claims) => new Set(claims.filter(Boolean)).size > 1,
    )
  )
    reasons.push("conflicting-native-required-claims");
  return {
    record,
    nativeIdentity: identity,
    nativeClaims: { years, vins, makeModels, destinations },
    validVinClaims,
    vin,
    year,
    destination: url && destinations.length === 1 ? url.href : null,
    reasons: [...new Set(reasons)],
  };
}
export const AlliedRecord = { schema: AlliedRecordSchema, assess } as const;
