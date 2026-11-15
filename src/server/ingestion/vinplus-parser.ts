import { VinplusRecordUnion } from "./vinplus-record-union";
import { createHash } from "node:crypto";
import { z } from "zod";
import { VINPLUS_API, type VinplusTenant } from "./vinplus-configuration";
import {
  parseVinplusAnalytics,
  parseVinplusYearSearch,
  vinplusOptionalText,
  vinplusYearQuery,
  vinplusStableRecord,
  type VinplusRecord,
  type VinplusScope,
} from "./vinplus-protocol";

export const vinplusHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const vinplusScope = (tenant: VinplusTenant): VinplusScope => ({
  yardId: tenant.yardId,
  yardName:
    tenant.inventory.kind === "crush"
      ? tenant.label
      : tenant.inventory.yardLocation,
  sourceSystem: tenant.inventory.kind,
  stockSchema: z
    .string()
    .regex(
      tenant.inventory.kind === "crush"
        ? new RegExp(`^STK\\d{${tenant.inventory.stockDigits}}$`)
        : /^(?:X?PUP\d{1,12}|\d{12})$/,
    ),
  maxStocks: 10_000,
});
export interface VinplusControl {
  url: string;
  mime: "text/html" | "application/json";
  body: string | null;
}
export type VinplusProgress =
  | { kind: "pending"; control: VinplusControl }
  | { kind: "complete"; records: VinplusRecord[] };
type Counts = ReturnType<typeof parseVinplusAnalytics>;
export interface VinplusRange {
  min: number;
  max: number;
  make: string | null;
}
const stable = (records: readonly VinplusRecord[]) =>
  records.map(vinplusStableRecord);
const get = (
  url: string,
  mime: VinplusControl["mime"] = "application/json",
): VinplusControl => ({ url, mime, body: null });
const search = (
  tenant: VinplusTenant,
  range: VinplusRange,
): VinplusControl => ({
  url: VINPLUS_API + "/searchVehicleHttp",
  mime: "application/json",
  body: JSON.stringify(
    vinplusYearQuery(vinplusScope(tenant), range.min, range.max, range.make),
  ),
});
function* readRange(
  tenant: VinplusTenant,
  range: VinplusRange,
): Generator<VinplusControl, VinplusRecord[], string> {
  const records = parseVinplusYearSearch(
    yield search(tenant, range),
    vinplusScope(tenant),
    range.min,
    range.max,
    range.make,
    "retain",
  );
  if (range.make !== null && records.length >= 100)
    throw new Error(
      `${tenant.yardId} ${range.min}-${range.max} ${range.make}: public query reached the silent 100-record cap; requalify narrower controls`,
    );
  return records;
}
/** Append only literal, not-yet-read make partitions until each year reconciles. */
function* supplementRanges(
  tenant: VinplusTenant,
  years: Counts["years"],
  candidates: readonly string[],
  ranges: VinplusRange[],
  pages: VinplusRecord[][],
  union: VinplusRecordUnion,
): Generator<VinplusControl, void, string> {
  for (const row of years) {
    const tried = new Set(
      ranges
        .filter((range) => range.min === row.year && range.max === row.year)
        .map((range) => range.make),
    );
    for (const make of candidates) {
      if (union.yearCount(row.year) === row.count) break;
      if (tried.has(make)) continue;
      const range = { min: row.year, max: row.year, make };
      const records = yield* readRange(tenant, range);
      pages.push(records);
      union.add(records);
      ranges.push(range);
    }
  }
}
function app(raw: string) {
  if (
    !/<\/html>\s*$/i.test(raw) ||
    !raw.includes("<title>Just In VIN+</title>") ||
    !raw.includes(`var CLOUD_RUN_URL = '${VINPLUS_API}'`)
  )
    throw new Error(
      "Public app no longer publishes the verified VinPlus backend",
    );
}
function config(raw: string, tenant: VinplusTenant) {
  return z
    .object({
      success: z.literal(true),
      yard_info: z.object({
        yard_id: z.literal(tenant.yardId),
        yard_name: z.literal(tenant.label),
        business_name: z.literal(tenant.label),
        timezone: z.literal(tenant.timezone),
        multi_location_enabled: z.literal(false),
        per_location_mode_enabled: z.literal(false),
        locations: z.array(z.never()).length(0),
        features: z.object({
          hide_vehicle_search: z.literal(tenant.hiddenSearch),
        }),
      }),
    })
    .parse(JSON.parse(raw));
}
/** Discovery is a control only. Counts, complete per-make reads and closing
 * replays establish donors. A missing make can never silently reduce coverage. */
function* traversal(
  tenant: VinplusTenant,
): Generator<VinplusControl, VinplusRecord[], string> {
  const appControl = get(
    `https://vinplus.texnrewards.com/parts/${tenant.slug}`,
    "text/html",
  );
  const openingApp = yield appControl;
  app(openingApp);
  const configControl = get(VINPLUS_API + "/api/yard-info/" + tenant.yardId);
  const openingConfig = yield configControl;
  config(openingConfig, tenant);
  const countControl = get(
    VINPLUS_API + "/api/analytics/year-distribution?yard_id=" + tenant.yardId,
  );
  const counts = parseVinplusAnalytics(yield countControl, 10_000);
  const makes = new Map<number, string[]>();
  for (const row of counts.years.filter((row) => row.count > 100)) {
    const range = { min: row.year, max: row.year, make: null };
    const records = parseVinplusYearSearch(
      yield search(tenant, range),
      vinplusScope(tenant),
      row.year,
      row.year,
      null,
      "retain",
    );
    if (records.length !== 100)
      throw new Error(
        "Large-year discovery changed the verified 100-record cap",
      );
    const literals = [
      ...new Set(records.map((record) => vinplusOptionalText(record.make))),
    ];
    if (literals.some((make) => make === null))
      throw new Error("Large-year discovery lacks a literal make selector");
    makes.set(
      row.year,
      z.array(z.string().min(1).max(100)).min(1).parse(literals).sort(),
    );
  }
  const ranges = vinplusRanges(counts, makes);
  const pages: VinplusRecord[][] = [];
  const union = VinplusRecordUnion.create();
  for (const range of ranges) {
    const records = yield* readRange(tenant, range);
    pages.push(records);
    union.add(records);
  }
  // A capped year can omit a make entirely. Supplement its discovered makes
  // with literal makes observed in the rest of this tenant's opening census.
  const allMakes = [
    ...new Set(
      pages
        .flat()
        .map((record) => vinplusOptionalText(record.make))
        .filter((make) => make !== null),
    ),
  ].sort();
  if (
    counts.years.some(
      (row) => row.count <= 100 && union.yearCount(row.year) !== row.count,
    )
  )
    throw new Error("Uncapped year did not reconcile with its published total");
  yield* supplementRanges(
    tenant,
    counts.years.filter((row) => row.count > 100),
    allMakes,
    ranges,
    pages,
    union,
  );
  let menuHash: string | null = null;
  const menuControl = get(VINPLUS_API + "/api/vehicle-groups");
  const unresolved = counts.years.filter(
    (row) => union.yearCount(row.year) !== row.count,
  );
  if (unresolved.length) {
    const raw = yield menuControl;
    const menu = z
      .object({
        success: z.literal(true),
        data: z.record(z.array(z.unknown()).max(1000)),
      })
      .strict()
      .parse(JSON.parse(raw));
    const publishedMakes = Object.keys(menu.data).sort();
    if (
      publishedMakes.length < 1 ||
      publishedMakes.length > 128 ||
      publishedMakes.some((make) => vinplusOptionalText(make) !== make)
    )
      throw new Error("Public vehicle directory has invalid make controls");
    menuHash = vinplusHash(JSON.parse(raw));
    yield* supplementRanges(
      tenant,
      unresolved,
      publishedMakes,
      ranges,
      pages,
      union,
    );
  }
  const records = union.records();
  if (
    (records.length - new Set(records.map((record) => record.stock)).size) /
      records.length >
    0.25
  )
    throw new Error(
      "Repeated stock occurrences exceed the 25% duplicate guard",
    );
  const actual = new Map<number, number>();
  for (const record of records)
    actual.set(record.year, (actual.get(record.year) ?? 0) + 1);
  if (
    records.length !== counts.count ||
    counts.years.some((row) => actual.get(row.year) !== row.count)
  )
    throw new Error(
      `Complete stock union has ${records.length} of ${counts.count} published records; year mismatches: ${counts.years
        .filter((row) => actual.get(row.year) !== row.count)
        .map((row) => `${row.year}: ${actual.get(row.year) ?? 0}/${row.count}`)
        .join(
          ", ",
        )}. Inventory may be truncated or a discovery make is missing`,
    );
  for (const [index, range] of ranges.entries()) {
    const closing = yield* readRange(tenant, range);
    if (
      vinplusHash(stable(closing)) !== vinplusHash(stable(pages[index] ?? []))
    )
      throw new Error(
        "Closing inventory changed a whole record, field or order (derived daysInYard and YardSmart photo signatures are ignored)",
      );
  }
  if (
    vinplusHash(parseVinplusAnalytics(yield countControl, 10_000)) !==
    vinplusHash(counts)
  )
    throw new Error("Closing year distribution drifted");
  const closingConfig = yield configControl;
  config(closingConfig, tenant);
  if (
    vinplusHash(JSON.parse(closingConfig)) !==
    vinplusHash(JSON.parse(openingConfig))
  )
    throw new Error("Closing public tenant configuration drifted");
  if (
    menuHash !== null &&
    vinplusHash(JSON.parse(yield menuControl)) !== menuHash
  )
    throw new Error("Closing public make directory drifted");
  const closingApp = yield appControl;
  app(closingApp);
  if (closingApp !== openingApp)
    throw new Error("Public app changed during traversal");
  return records;
}
export function vinplusRanges(
  counts: Counts,
  makes: ReadonlyMap<number, readonly string[]>,
): VinplusRange[] {
  const ranges: Array<VinplusRange & { count: number }> = [];
  for (const row of counts.years) {
    if (row.count > 100) {
      const selectors = makes.get(row.year);
      if (!selectors?.length)
        throw new Error("Large year lacks completed make discovery");
      ranges.push(
        ...selectors.map((make) => ({
          min: row.year,
          max: row.year,
          make,
          count: 100,
        })),
      );
    } else {
      const prior = ranges.at(-1);
      if (prior && prior.make === null && prior.count + row.count <= 90) {
        prior.max = row.year;
        prior.count += row.count;
      } else
        ranges.push({
          min: row.year,
          max: row.year,
          make: null,
          count: row.count,
        });
    }
  }
  return ranges.map(({ count: _count, ...range }) => range);
}
/** Re-executes the finite protocol from a contiguous saved response prefix. */
export function inspectVinplusEvidence(
  tenant: VinplusTenant,
  bodies: readonly string[],
): VinplusProgress {
  const run = traversal(tenant);
  let step = run.next();
  for (const body of bodies) {
    if (step.done)
      throw new Error(
        "Checkpoint contains responses beyond terminal public controls",
      );
    step = run.next(body);
  }
  return step.done
    ? { kind: "complete", records: step.value }
    : { kind: "pending", control: step.value };
}
