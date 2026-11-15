import { z } from "zod";
import { inventoryVin } from "./inventory-vin";

const ORIGIN = "https://northwestautoparts.com";
const ControlSchema = z
  .object({ path: z.string(), label: z.string() })
  .strict();
export const NorthwestContextSchema = z
  .object({
    kind: z.literal("model"),
    make: ControlSchema,
    model: ControlSchema,
  })
  .strict();
export type NorthwestContext = z.infer<typeof NorthwestContextSchema>;
export const NorthwestRecordSchema = z
  .object({
    occurrenceId: z.string().min(1),
    sourceUrl: z.string(),
    context: NorthwestContextSchema,
    years: z.array(z.string()),
    titles: z.array(z.string()),
    vins: z.array(z.string()),
    inquiries: z.array(z.string()).default([]),
    destinations: z.array(z.string()),
    stockNumbers: z.array(z.string()).default([]),
    imageUrls: z.array(z.string()).default([]),
    availableDates: z.array(z.string()).default([]),
    colors: z.array(z.string()).default([]),
    sections: z.array(z.string()).default([]),
    rows: z.array(z.string()).default([]),
    spaces: z.array(z.string()).default([]),
  })
  .strict();
export type NorthwestRecord = z.infer<typeof NorthwestRecordSchema>;
export type NorthwestRejectionReason =
  | "missing-or-invalid-native-year"
  | "missing-or-invalid-native-vin"
  | "native-parent-leaf-title-mismatch"
  | "native-inquiry-identity-mismatch"
  | "native-source-page-context-mismatch"
  | "native-donor-destination-missing-conflicting-or-unowned"
  | "conflicting-native-required-claims";
export interface NorthwestNativeIdentity {
  vin: string;
  year: number;
  make: string;
  model: string;
  leaf: string;
  destination: string;
}
type Evidence = {
  record: NorthwestRecord;
  nativeClaims: {
    years: string[];
    makeModels: string[];
    vins: string[];
    destinations: string[];
  };
  resolvedDestinations: { literal: string; url: string | null }[];
  validVinClaims: string[];
  reasons: NorthwestRejectionReason[];
};
export type NorthwestAssessment = Evidence &
  (
    | { status: "required-pass"; identity: NorthwestNativeIdentity }
    | { status: "required-reject"; identity: null }
  );
const one = (values: readonly string[]) =>
  new Set(values).size === 1 ? (values[0] ?? "") : "";
const usable = (value: string) =>
  /[A-Z0-9]/i.test(value) &&
  !/^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(value);
const owned = (url: URL | null): url is URL =>
  url !== null &&
  url.origin === ORIGIN &&
  !url.username &&
  !url.password &&
  !url.search &&
  !url.hash;

function assess(record: NorthwestRecord): NorthwestAssessment {
  const { make: parent, model: control } = record.context;
  const make = parent.label,
    leaf = control.label;
  const rawYear = one(record.years),
    rawVin = one(record.vins),
    title = one(record.titles);
  const full = `${make} ${leaf}`;
  // The native parent delimits the native card, including VOLVO + VOLVO 60 SERIES.
  // Neither a route nor an inquiry can supply a missing card model.
  const titleOk =
    title === full || (title === leaf && leaf.startsWith(make + " "));
  const model =
    titleOk && title.startsWith(make + " ") ? title.slice(make.length + 1) : "";
  const identityKey =
    usable(make) && usable(model) ? JSON.stringify([make, model, leaf]) : null;
  // A bare make-as-leaf card and its repeated-make inquiry share a native
  // presentation. This equivalence never fills the missing candidate model.
  const presentationKey =
    identityKey ??
    (title === make && leaf === make && usable(make)
      ? JSON.stringify([make, leaf, leaf])
      : null);
  const expectedModel = leaf.startsWith(make + " ")
    ? leaf.slice(make.length + 1)
    : leaf;
  const inquiryKey =
    usable(make) && usable(expectedModel)
      ? (identityKey ?? JSON.stringify([make, expectedModel, leaf]))
      : null;
  const years = [...record.years],
    vins = [...record.vins];
  const makeModels = record.titles.map((claim) =>
    claim === title && presentationKey !== null ? presentationKey : claim,
  );
  const reasons: NorthwestRejectionReason[] = [];
  for (const inquiry of record.inquiries) {
    const claim = /^(\d{4})\s+(.*?)\s+-\s+VIN\s*(.*)$/.exec(inquiry);
    if (claim) {
      years.push(claim[1] ?? "");
      vins.push(claim[3] ?? "");
      makeModels.push(
        claim[2] === full && inquiryKey !== null
          ? inquiryKey
          : (claim[2] ?? ""),
      );
    }
    for (const found of inquiry.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi))
      vins.push(found[0]);
    if (inquiry !== `${rawYear} ${full} - VIN ${rawVin}`)
      reasons.push("native-inquiry-identity-mismatch");
  }
  const year =
    /^\d{4}$/.test(rawYear) &&
    Number(rawYear) >= 1886 &&
    Number(rawYear) <= 2100
      ? Number(rawYear)
      : null;
  const vin = inventoryVin(rawVin, rawYear);
  if (year === null) reasons.push("missing-or-invalid-native-year");
  if (vin === null) reasons.push("missing-or-invalid-native-vin");
  if (!titleOk || identityKey === null)
    reasons.push("native-parent-leaf-title-mismatch");

  const source = URL.parse(record.sourceUrl);
  const modelPath = control.path.replace(/\/$/, "");
  if (
    !owned(source) ||
    source.pathname.replace(/\/$/, "") !== modelPath ||
    !/^\/parts\/[^/?#]+$/.test(parent.path) ||
    !/^\/parts\/[^/?#]+\/[^/?#]+$/.test(modelPath) ||
    !modelPath.startsWith(parent.path + "/")
  )
    reasons.push("native-source-page-context-mismatch");
  const urls = record.destinations.map((literal) =>
    URL.parse(literal, record.sourceUrl),
  );
  const resolvedDestinations = record.destinations.map((literal, index) => ({
    literal,
    url: urls[index]?.href ?? null,
  }));
  const destinations = resolvedDestinations.map(
    ({ literal, url }) => url ?? literal,
  );
  const destination = urls[0];
  if (
    !urls.length ||
    urls.some((url) => {
      if (!owned(url)) return true;
      const parts = url.pathname.split("/");
      return (
        parts.length !== 6 ||
        parts.slice(0, 4).join("/") !== modelPath ||
        !parts[4] ||
        parts[5] !== rawYear
      );
    })
  )
    reasons.push("native-donor-destination-missing-conflicting-or-unowned");
  const nativeClaims = {
    years,
    makeModels,
    vins: vins.map((value) => value.trim().toUpperCase()),
    destinations,
  };
  if (
    Object.values(nativeClaims).some(
      (claims) => new Set(claims.filter((v) => v.trim())).size > 1,
    )
  )
    reasons.push("conflicting-native-required-claims");
  // Preserve every valid native identity, even when this occurrence cannot emit.
  const validVinClaims = [
    ...new Set(
      vins.flatMap((value) => {
        const embedded = [...value.matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi)].map(
          (match) => match[0],
        );
        return [value, ...embedded].flatMap((claim) =>
          ["", ...years].flatMap((nativeYear) => {
            const valid = inventoryVin(claim, nativeYear);
            return valid === null ? [] : [valid];
          }),
        );
      }),
    ),
  ].sort();
  const evidence = {
    record,
    nativeClaims,
    resolvedDestinations,
    validVinClaims,
    reasons: [...new Set(reasons)],
  };
  if (
    reasons.length ||
    vin === null ||
    year === null ||
    identityKey === null ||
    !destination
  )
    return { ...evidence, status: "required-reject", identity: null };
  return {
    ...evidence,
    status: "required-pass",
    identity: {
      vin,
      year,
      make,
      model,
      leaf,
      destination: destination.href,
    },
  };
}

/** Unknown native claim objects must pass this strict boundary before assessment. */
export const NorthwestRecord = {
  schema: NorthwestRecordSchema,
  parse: (input: unknown) => NorthwestRecordSchema.safeParse(input),
  assess,
} as const;
