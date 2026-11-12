import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  LITTLETON_EMBED_URL,
  LITTLETON_INVENTORY_URL,
  LITTLETON_ORIGIN,
  LITTLETON_YARD,
} from "./littleton-yard-metadata";

export const LITTLETON_MAX_STOCKS = 10_000;
export const LITTLETON_MAX_QUERIES = 2_000;
export const LittletonStockSchema = z.string().regex(/^STK\d{6}$/);
const yearSchema = z.number().int().min(1886).max(2100);
export interface LittletonPair {
  make: string;
  model: string;
}
export interface LittletonTableRow extends LittletonPair {
  stock: string;
  year: number;
  row: string | null;
  date: string | null;
}
export const littletonHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const littletonPairKey = (pair: LittletonPair): string =>
  JSON.stringify([pair.make, pair.model]);
export function littletonOptionalText(value: unknown): string | null {
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
function calendarDate(year: number, month: number, day: number): string | null {
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
export function littletonSourceDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?$/.exec(
      value,
    );
  return match &&
    Number(match[4]) < 24 &&
    Number(match[5]) < 60 &&
    Number(match[6]) < 60
    ? calendarDate(Number(match[1]), Number(match[2]), Number(match[3]))
    : null;
}
function tableDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(value);
  return match
    ? calendarDate(2000 + Number(match[3]), Number(match[1]), Number(match[2]))
    : null;
}
function htmlText(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = entities.get(key.toLowerCase());
        if (value === undefined)
          throw new Error("Unsupported Littleton inventory entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Littleton character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function completeDocument(raw: string) {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(raw))
    throw new Error("Littleton HTML is oversized or truncated");
  const embeds = [...raw.matchAll(/\biframe\.src\s*=\s*(["'])(.*?)\1\s*;/g)];
  if (embeds.length !== 1 || embeds[0]?.[2] !== LITTLETON_EMBED_URL)
    throw new Error(
      "Littleton official VinPlus destination changed or is ambiguous",
    );
}
export function parseLittletonOwner(raw: string): void {
  completeDocument(raw);
  // The root contains unrelated customer prose/entities. Only the required
  // ownership statements are compared here; inventory cells decode strictly.
  const body = stripInventoryRawText(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  if (
    !body.includes(LITTLETON_YARD.address) ||
    !body.includes("Littleton, CO 80125") ||
    !body.replace(/\D/g, "").includes("3037911380") ||
    !body.includes(
      "Our entire inventory is placed on stands for the convenience of our customer, so all you have to do is bring your own tools and pull the parts you need.",
    )
  )
    throw new Error(
      "Littleton physical ownership or self-service active inventory statement changed",
    );
}
const collectionSchema = z.object({
  "@type": z.literal("CollectionPage"),
  url: z.literal(LITTLETON_INVENTORY_URL),
  description: z.string().includes("Inventory is updated daily."),
  mainEntity: z.object({
    "@type": z.literal("ItemList"),
    description: z.literal("Used vehicle inventory updated daily."),
  }),
  provider: z.object({
    "@type": z.literal("AutoPartsStore"),
    name: z.literal(LITTLETON_YARD.name),
    url: z.literal(LITTLETON_ORIGIN + "/"),
    address: z.object({
      streetAddress: z.literal(LITTLETON_YARD.address),
      addressLocality: z.literal("Littleton"),
      addressRegion: z.literal("CO"),
      postalCode: z.literal("80125"),
      addressCountry: z.literal("US"),
    }),
  }),
});
function tableRows(section: string, cell: "th" | "td"): string[][] {
  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length !== [...section.matchAll(/<\/?tr\b/gi)].length / 2 ||
    section.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error("Littleton table has incomplete or out-of-row cells");
  return rows.map((match) => {
    const row = match[1] ?? "";
    const pattern = new RegExp(
      `<${cell}\\b[^>]*>([\\s\\S]*?)<\\/${cell}\\s*>`,
      "gi",
    );
    const cells = [...row.matchAll(pattern)];
    if (
      cells.length !== 6 ||
      [...row.matchAll(/<\/?(?:td|th)\b/gi)].length !== 12 ||
      row.replace(pattern, "").trim()
    )
      throw new Error(
        "Littleton table row does not contain six complete cells",
      );
    return cells.map((cell) => htmlText(cell[1] ?? ""));
  });
}
export function parseLittletonInventory(raw: string) {
  completeDocument(raw);
  const collections = [
    ...raw.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi),
  ]
    .filter(
      (m) =>
        inventoryHtmlAttribute(m[1] ?? "", "type") === "application/ld+json",
    )
    .map((m): unknown => JSON.parse(m[2] ?? ""))
    .filter((value) => collectionSchema.safeParse(value).success);
  if (collections.length !== 1)
    throw new Error(
      "Littleton current inventory collection or physical provider changed",
    );
  const html = stripInventoryRawText(raw);
  const allTables = [
    ...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi),
  ];
  const tables = allTables.filter((m) =>
    (inventoryHtmlAttribute(m[1] ?? "", "class") ?? "")
      .split(/\s+/)
      .includes("table-parts"),
  );
  if (
    tables.length !== 1 ||
    allTables.length !== [...html.matchAll(/<table\b/gi)].length ||
    allTables.length !== [...html.matchAll(/<\/table\b/gi)].length
  )
    throw new Error(
      "Littleton complete inventory table is missing or ambiguous",
    );
  const sections = inventoryTableSections(tables[0]?.[2] ?? "");
  if (
    JSON.stringify(tableRows(sections.head, "th")) !==
    JSON.stringify([
      ["Year", "Make", "Model", "Stock#", "Vehicle Row", "Date Set in Yard"],
    ])
  )
    throw new Error("Littleton inventory table headers changed");
  const rows: LittletonTableRow[] = tableRows(sections.body, "td").map(
    (cells) => {
      const [year, make, model, stock, row, date] = cells;
      if (
        !/^\d{4}$/.test(year ?? "") ||
        !littletonOptionalText(make) ||
        !littletonOptionalText(model) ||
        !make ||
        !model
      )
        throw new Error(
          "Littleton table is missing required native year/make/model traversal scope",
        );
      return {
        year: yearSchema.parse(Number(year)),
        make,
        model,
        stock: LittletonStockSchema.parse(stock),
        row: littletonOptionalText(row),
        date: tableDate(date ?? ""),
      };
    },
  );
  rows.sort((a, b) => (a.stock < b.stock ? -1 : a.stock > b.stock ? 1 : 0));
  if (
    !rows.length ||
    rows.length > LITTLETON_MAX_STOCKS ||
    new Set(rows.map((r) => r.stock)).size !== rows.length
  )
    throw new Error(
      "Littleton stock coverage is empty, oversized or duplicated",
    );
  const pairs = [
    ...new Map(
      rows.map((r) => [littletonPairKey(r), { make: r.make, model: r.model }]),
    ).values(),
  ].sort((a, b) =>
    littletonPairKey(a) < littletonPairKey(b)
      ? -1
      : littletonPairKey(a) > littletonPairKey(b)
        ? 1
        : 0,
  );
  if (pairs.length > LITTLETON_MAX_QUERIES)
    throw new Error(
      "Littleton native query directory exceeds the bounded traversal limit",
    );
  return { rows, pairs };
}
const configSchema = z.object({
  success: z.literal(true),
  yard_info: z.object({
    yard_id: z.literal("littleton_u_pull_it"),
    yard_name: z.literal(LITTLETON_YARD.name),
    business_name: z.literal(LITTLETON_YARD.name),
    multi_location_enabled: z.literal(false),
    per_location_mode_enabled: z.literal(false),
    locations: z.array(z.unknown()).length(0),
    photos_enabled: z.literal(false),
    timezone: z.literal("America/Denver"),
    features: z.object({
      demo_freshness_enabled: z.literal(false),
      demo_synthesize_alert_matches: z.literal(false),
      hide_vehicle_search: z.literal(false),
      alert_only_mode: z.literal(false),
      store_phone: z.literal("(303) 791-1380"),
    }),
    url_settings: z.object({ custom_slug: z.literal("littleton") }),
  }),
});
export function parseLittletonConfig(raw: string) {
  return configSchema.parse(JSON.parse(raw));
}
const analyticsSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        current_count: z.number().int().positive().max(LITTLETON_MAX_STOCKS),
        by_year: z
          .array(
            z
              .object({
                year: z.string().regex(/^\d{4}$/),
                count: z.number().int().positive().max(LITTLETON_MAX_STOCKS),
              })
              .strict(),
          )
          .min(1)
          .max(215),
      })
      .strict(),
  })
  .strict();
export function parseLittletonAnalytics(raw: string) {
  const parsed = analyticsSchema.parse(JSON.parse(raw)).data;
  const years = parsed.by_year
    .map((row) => ({
      year: yearSchema.parse(Number(row.year)),
      count: row.count,
    }))
    .sort((a, b) => a.year - b.year);
  if (
    new Set(years.map((r) => r.year)).size !== years.length ||
    years.reduce((sum, r) => sum + r.count, 0) !== parsed.current_count
  )
    throw new Error(
      "Littleton native year distribution does not reconcile with current count",
    );
  return { count: parsed.current_count, years };
}
const recordSchema = z
  .object({
    stock: LittletonStockSchema,
    year: yearSchema,
    yardLocation: z.literal(LITTLETON_YARD.name),
    sourceSystem: z.literal("crush"),
    demo_offset_seconds: z.null().optional(),
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
export type LittletonRecord = z.infer<typeof recordSchema>;
export function littletonQuery(pair: LittletonPair) {
  return {
    yard_id: "littleton_u_pull_it",
    year_min: null,
    year_max: null,
    make: pair.make,
    model: pair.model,
    language: "en",
    location_id: null,
  } as const;
}
export function parseLittletonSearch(
  raw: string,
  pair: LittletonPair,
): LittletonRecord[] {
  const response = z
    .object({
      success: z.literal(true),
      match_count: z.number().int().nonnegative().max(LITTLETON_MAX_STOCKS),
      matches: z.array(recordSchema).max(LITTLETON_MAX_STOCKS),
      search_criteria: z
        .object({
          yard_id: z.literal("littleton_u_pull_it"),
          year_min: z.null(),
          year_max: z.null(),
          make: z.literal(pair.make),
          model: z.literal(pair.model),
        })
        .strict(),
    })
    .strict()
    .parse(JSON.parse(raw));
  if (
    response.match_count !== response.matches.length ||
    new Set(response.matches.map((r) => r.stock)).size !==
      response.matches.length
  )
    throw new Error(
      "Littleton native search returned a partial match count or duplicate stock",
    );
  return response.matches;
}
