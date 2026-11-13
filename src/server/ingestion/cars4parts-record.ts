import { z } from "zod";
import { cars4partsLeafUrl } from "./cars4parts-html";
import { inventoryVin } from "./inventory-vin";

const strings = z.array(z.string().max(1000)).max(256);
export const Cars4PartsRecordSchema = z
  .object({
    destination: z.string().max(1000),
    canonicalClaims: strings,
    titles: strings,
    headings: strings,
    branches: strings,
    vins: strings,
    proseFields: z
      .object({ year: strings, make: strings, model: strings, vin: strings })
      .strict(),
    narrative: z.string().max(500_000),
    stock: strings,
    colors: strings,
    images: strings,
  })
  .strict();
export type Cars4PartsRecord = z.infer<typeof Cars4PartsRecordSchema>;
export const CARS4PARTS_BRANCHES = {
  "Heyworth IL, Ph: 309-220-8410": "heyworth",
  "Armington IL, Ph: 309-392-2000": "armington",
} as const;
export type Cars4PartsBranch =
  (typeof CARS4PARTS_BRANCHES)[keyof typeof CARS4PARTS_BRANCHES];
export const cars4partsBranch = (label: string): Cars4PartsBranch | null => {
  if (label === "Heyworth IL, Ph: 309-220-8410") return "heyworth";
  if (label === "Armington IL, Ph: 309-392-2000") return "armington";
  return null;
};
export const cars4partsClaimKey = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
const one = (values: readonly string[]) =>
  new Set(values.map(cars4partsClaimKey)).size === 1
    ? (values[0] ?? null)
    : null;
export function assessCars4PartsRecord(
  record: Cars4PartsRecord,
  makes: readonly string[],
) {
  const reasons: string[] = [];
  const title = one(record.titles);
  const match = title === null ? null : /^(\d{4})\s+(.+)$/.exec(title);
  const yearText = match?.[1] ?? "";
  const rest = match?.[2] ?? "";
  const candidates = makes.filter((make) => rest.startsWith(make + " "));
  const make = candidates.length === 1 ? (candidates[0] ?? null) : null;
  const model = make === null ? null : rest.slice(make.length + 1).trim();
  const year =
    /^\d{4}$/.test(yearText) &&
    Number(yearText) >= 1886 &&
    Number(yearText) <= 2100
      ? Number(yearText)
      : null;
  if (year === null || make === null || !model)
    reasons.push("missing-or-ambiguous-native-ymm");
  for (const [key, actual] of [
    ["year", yearText],
    ["make", make],
    ["model", model],
  ] as const) {
    if (
      actual !== null &&
      record.proseFields[key].some(
        (value) => cars4partsClaimKey(value) !== cars4partsClaimKey(actual),
      )
    )
      reasons.push("conflicting-native-" + key);
  }
  const validVinClaims = [
    ...new Set(
      record.vins.flatMap((value) => {
        const parsed = inventoryVin(value, yearText);
        return parsed === null ? [] : [parsed];
      }),
    ),
  ].sort();
  const vin = one(record.vins)?.toUpperCase() ?? null;
  if (validVinClaims.length > 1) reasons.push("conflicting-native-vin");
  if (vin === null || inventoryVin(vin, yearText) === null)
    reasons.push("missing-or-invalid-native-vin");
  if (
    !cars4partsLeafUrl(record.destination) ||
    record.canonicalClaims.length !== 2 ||
    record.canonicalClaims.some((value) => value !== record.destination)
  )
    reasons.push("conflicting-or-unowned-native-destination");
  const branchLabel = one(record.branches);
  const branch = branchLabel === null ? null : cars4partsBranch(branchLabel);
  if (branch === null) reasons.push("missing-or-conflicting-native-branch");
  // Named-vehicle parts prose establishes scope. A badge, navigation link,
  // source-wide used-parts advertisement or whole-car offer cannot decide it.
  const donor =
    record.headings.some((value) =>
      /(?:parting\s+(?:out\s+)?\d{4}\b|\bfor\s+parts\s+\d{4}\b|\b\d{4}\b.*\b(?:cheap\s+(?:oem\s+)?parts|any\s+part)\b)/i.test(
        value,
      ),
    ) ||
    /\b(?:any\s+parts?\s+(?:you|u)\s+(?:need|want)|you\s+must\s+pull\s+your\s+own\s+part|we\s+can\s+part\s+it\s+out)\b/i.test(
      record.narrative,
    );
  const retail =
    !donor && record.headings.some((value) => /^for sale\b/i.test(value));
  const role = donor ? "donor" : retail ? "retail" : "unresolved";
  return {
    record,
    reasons,
    validVinClaims,
    vin,
    year,
    make,
    model,
    branch,
    role,
  };
}
export const Cars4PartsRecord = {
  schema: Cars4PartsRecordSchema,
  assess: assessCars4PartsRecord,
} as const;
