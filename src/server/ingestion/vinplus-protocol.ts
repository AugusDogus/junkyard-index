import { z } from "zod";

export interface VinplusPair {
  make: string;
  model: string;
}

/** The caller supplies its verified native owner and stock grammar. */
export interface VinplusScope {
  yardId: string;
  yardName: string;
  sourceSystem: string;
  stockSchema: z.ZodType<string>;
  maxStocks: number;
}

export const VinplusYearSchema = z.number().int().min(1886).max(2100);

export function vinplusOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return !text ||
    text.length > 100 ||
    /[<>]/.test(text) ||
    [...text].some((character) => character.charCodeAt(0) < 32) ||
    /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(text)
    ? null
    : text;
}

export function vinplusCalendarDate(
  year: number,
  month: number,
  day: number,
): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1886 &&
    year <= 2100 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString().slice(0, 10)
    : null;
}

/** Native dateAdded has no UTC offset. Preserve its calendar date only. */
export function vinplusSourceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/.exec(
      value,
    );
  return match &&
    Number(match[4]) < 24 &&
    Number(match[5]) < 60 &&
    Number(match[6]) < 60
    ? vinplusCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}

export function vinplusQuery(scope: VinplusScope, pair: VinplusPair) {
  return {
    yard_id: scope.yardId,
    year_min: null,
    year_max: null,
    make: pair.make,
    model: pair.model,
    language: "en",
    location_id: null,
  } as const;
}

function recordSchema(scope: VinplusScope) {
  return z
    .object({
      stock: scope.stockSchema,
      year: VinplusYearSchema,
      yardLocation: z.literal(scope.yardName),
      sourceSystem: z.literal(scope.sourceSystem),
      demo_offset_seconds: z.null().optional(),
      recencyAnchor: z.unknown().optional(),
      vin: z.unknown().optional(),
      make: z.unknown().optional(),
      model: z.unknown().optional(),
      color: z.unknown().optional(),
      vehicleRow: z.unknown().optional(),
      dateAdded: z.unknown().optional(),
      damage_condition: z.unknown().optional(),
      daysInYard: z.unknown().optional(),
      engine: z.unknown().optional(),
      fuel_type: z.unknown().optional(),
      imageUrl: z.unknown().optional(),
      imageUrls: z.unknown().optional(),
      transmission: z.unknown().optional(),
    })
    .strict();
}
export type VinplusRecord = z.infer<ReturnType<typeof recordSchema>>;

/** YardSmart signs public photo redirects on each search. Compare their stable
 * host and filename, preserving other URL fields and unknown hosts verbatim. */
function stablePhoto(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(
    /^(https:\/\/api\.yardsmartapp\.com\/rails\/active_storage\/blobs\/redirect\/)[^/?#]+\/([^/?#]+)$/,
    "$1$2",
  );
}
export function vinplusStableRecord(record: VinplusRecord) {
  const stable = { ...record };
  delete stable.daysInYard;
  if (record.sourceSystem === "yardsmart") {
    stable.imageUrl = stablePhoto(record.imageUrl);
    const images = z.array(z.unknown()).safeParse(record.imageUrls);
    if (images.success) stable.imageUrls = images.data.map(stablePhoto);
  }
  return stable;
}

export function parseVinplusSearch(
  raw: string,
  scope: VinplusScope,
  pair: VinplusPair,
  duplicateStocks: "reject" | "retain" = "reject",
): VinplusRecord[] {
  return parseSearch(
    raw,
    scope,
    {
      yard_id: z.literal(scope.yardId),
      year_min: z.null(),
      year_max: z.null(),
      make: z.literal(pair.make),
      model: z.literal(pair.model),
    },
    duplicateStocks,
  );
}

/** Public app year controls permit an unset make/model. Bounded year ranges
 * are independently reconciled against the complete published distribution. */
export function vinplusYearQuery(
  scope: VinplusScope,
  min: number,
  max: number,
  make: string | null = null,
) {
  VinplusYearSchema.parse(min);
  VinplusYearSchema.parse(max);
  if (min > max) throw new Error("VinPlus year range is reversed");
  if (
    make !== null &&
    (vinplusOptionalText(make) !== make || /[*%]/.test(make))
  )
    throw new Error(
      "VinPlus year query requires a published literal make or explicit null",
    );
  return {
    yard_id: scope.yardId,
    year_min: min,
    year_max: max,
    make,
    model: null,
    language: "en",
    location_id: null,
  } as const;
}
export function parseVinplusYearSearch(
  raw: string,
  scope: VinplusScope,
  min: number,
  max: number,
  make: string | null = null,
  duplicateStocks: "reject" | "retain" = "reject",
) {
  vinplusYearQuery(scope, min, max, make);
  const records = parseSearch(
    raw,
    scope,
    {
      yard_id: z.literal(scope.yardId),
      year_min: z.literal(min),
      year_max: z.literal(max),
      make: make === null ? z.null() : z.literal(make),
      model: z.null(),
    },
    duplicateStocks,
  );
  if (records.some((record) => record.year < min || record.year > max))
    throw new Error("VinPlus returned a vehicle outside the requested years");
  return records;
}
function parseSearch(
  raw: string,
  scope: VinplusScope,
  criteria: z.ZodRawShape,
  duplicateStocks: "reject" | "retain",
) {
  const response = z
    .object({
      success: z.literal(true),
      match_count: z.number().int().nonnegative().max(scope.maxStocks),
      matches: z.array(recordSchema(scope)).max(scope.maxStocks),
      search_criteria: z.object(criteria).strict(),
    })
    .strict()
    .parse(JSON.parse(raw));
  if (
    response.match_count !== response.matches.length ||
    (duplicateStocks === "reject" &&
      new Set(response.matches.map((record) => record.stock)).size !==
        response.matches.length)
  )
    throw new Error(
      "VinPlus search returned a partial match count or duplicate native stock",
    );
  return response.matches;
}

export function parseVinplusAnalytics(raw: string, maxStocks: number) {
  const parsed = z
    .object({
      success: z.literal(true),
      data: z
        .object({
          current_count: z.number().int().positive().max(maxStocks),
          by_year: z
            .array(
              z
                .object({
                  year: z.string().regex(/^\d{4}$/),
                  count: z.number().int().positive().max(maxStocks),
                })
                .strict(),
            )
            .min(1)
            .max(215),
        })
        .strict(),
    })
    .strict()
    .parse(JSON.parse(raw)).data;
  const years = parsed.by_year
    .map((row) => ({
      year: VinplusYearSchema.parse(Number(row.year)),
      count: row.count,
    }))
    .sort((a, b) => a.year - b.year);
  if (
    new Set(years.map((row) => row.year)).size !== years.length ||
    years.reduce((sum, row) => sum + row.count, 0) !== parsed.current_count
  )
    throw new Error(
      "VinPlus year distribution does not reconcile with its current count",
    );
  return { count: parsed.current_count, years };
}
