import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  parseVinplusAnalytics,
  parseVinplusSearch,
  vinplusCalendarDate,
  vinplusOptionalText,
  vinplusQuery,
  VinplusYearSchema,
  type VinplusPair,
  type VinplusRecord,
} from "./vinplus-protocol";
import {
  JOLIET_CONTACT_URL,
  JOLIET_EMBED_URL,
  JOLIET_INVENTORY_URL,
  JOLIET_YARD,
} from "./joliet-yard-metadata";

export const JOLIET_MAX_STOCKS = 10_000;
export const JOLIET_MAX_QUERIES = 2_000;
export const JOLIET_MAX_DISAGREEMENT_RATIO = 0.05;
export const JolietStockSchema = z.string().regex(/^STK\d{6}$/);
export type JolietPair = VinplusPair;
export type JolietRecord = VinplusRecord;
export interface JolietTableRow extends JolietPair {
  stock: string;
  year: number;
  row: string | null;
  sourceSetDate: string | null;
}
const nativeScope = {
  yardId: "joliet_u_pull_it",
  yardName: JOLIET_YARD.name,
  sourceSystem: "crush",
  stockSchema: JolietStockSchema,
  maxStocks: JOLIET_MAX_STOCKS,
};
export const jolietHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function jolietYearCounts(rows: Iterable<{ year: number }>) {
  const years = new Map<number, number>();
  let count = 0;
  for (const row of rows) {
    years.set(row.year, (years.get(row.year) ?? 0) + 1);
    count++;
  }
  return {
    count,
    years: [...years]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year - b.year),
  };
}
export const jolietPairKey = (pair: JolietPair): string =>
  JSON.stringify([pair.make, pair.model]);
export const jolietQuery = (pair: JolietPair) =>
  vinplusQuery(nativeScope, pair);
export const parseJolietSearch = (raw: string, pair: JolietPair) =>
  parseVinplusSearch(raw, nativeScope, pair);
export const parseJolietAnalytics = (raw: string) =>
  parseVinplusAnalytics(raw, JOLIET_MAX_STOCKS);

function ownedDocument(raw: string): string {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(raw))
    throw new Error("Joliet HTML is oversized or truncated");
  const embeds = [...raw.matchAll(/\biframe\.src\s*=\s*(["'])(.*?)\1\s*;/g)];
  if (embeds.length !== 1 || embeds[0]?.[2] !== JOLIET_EMBED_URL)
    throw new Error(
      "Joliet native inventory destination changed or is ambiguous",
    );
  // The root JSON-LD and inventory heading contain copied Littleton content.
  // Exclude scripts and headings as ownership evidence. Require Joliet's
  // visible address, native phone anchor, navigation and exact iframe bridge.
  const html = stripInventoryRawText(raw);
  const body = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !body.includes(JOLIET_YARD.name) ||
    !body.includes(JOLIET_YARD.address) ||
    !body.includes("Joliet, IL 60433") ||
    !links.includes("tel:8157233011") ||
    !links.includes(JOLIET_INVENTORY_URL) ||
    !links.includes(JOLIET_CONTACT_URL)
  )
    throw new Error(
      "Joliet visible physical ownership or inventory navigation changed",
    );
  return html;
}
export function parseJolietOwner(raw: string): void {
  const body = ownedDocument(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  if (
    !body.includes(
      "Our entire inventory is placed on stands for the convenience of our customer, so all you have to do is bring your own tools and pull the parts you need.",
    )
  )
    throw new Error(
      "Joliet no longer confirms active self-service donor inventory",
    );
}
export function parseJolietContact(raw: string): void {
  ownedDocument(raw);
}

function cellText(raw: string): string {
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
          throw new Error("Unsupported Joliet cell entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Joliet character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function tableRows(section: string, cell: "th" | "td"): string[][] {
  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length !== [...section.matchAll(/<\/?tr\b/gi)].length / 2 ||
    section.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error("Joliet table has incomplete or out-of-row cells");
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
        "Joliet inventory row does not contain six complete cells",
      );
    return cells.map((value) => cellText(value[1] ?? ""));
  });
}
function sourceSetDate(value: string): string | null {
  const match = /^(\d{2})\.(\d{2})\.\d{2}$/.exec(value);
  // Validate month/day only. Keep the native two-digit-year representation;
  // the API's explicit full-year calendar date supplies canonical dates.
  return match && vinplusCalendarDate(2000, Number(match[1]), Number(match[2]))
    ? value
    : null;
}
export function parseJolietInventory(raw: string) {
  const html = ownedDocument(raw);
  const all = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)];
  const tables = all.filter((match) =>
    (inventoryHtmlAttribute(match[1] ?? "", "class") ?? "")
      .split(/\s+/)
      .includes("table-parts"),
  );
  if (
    tables.length !== 1 ||
    all.length !== [...html.matchAll(/<table\b/gi)].length ||
    all.length !== [...html.matchAll(/<\/table\b/gi)].length
  )
    throw new Error(
      "Joliet complete native inventory table is missing or ambiguous",
    );
  const sections = inventoryTableSections(tables[0]?.[2] ?? "");
  if (
    JSON.stringify(tableRows(sections.head, "th")) !==
    JSON.stringify([
      ["Year", "Make", "Model", "Stock#", "Vehicle Row", "Date Set in Yard"],
    ])
  )
    throw new Error("Joliet native inventory headers changed");
  const rows: JolietTableRow[] = tableRows(sections.body, "td")
    .map((cells) => {
      const [year, make, model, stock, row, date] = cells;
      if (
        !/^\d{4}$/.test(year ?? "") ||
        !vinplusOptionalText(make) ||
        !vinplusOptionalText(model) ||
        !make ||
        !model
      )
        throw new Error(
          "Joliet table lacks required native year/make/model traversal scope",
        );
      return {
        year: VinplusYearSchema.parse(Number(year)),
        make,
        model,
        stock: JolietStockSchema.parse(stock),
        row: vinplusOptionalText(row),
        sourceSetDate: sourceSetDate(date ?? ""),
      };
    })
    .sort((a, b) => (a.stock < b.stock ? -1 : a.stock > b.stock ? 1 : 0));
  if (
    !rows.length ||
    rows.length > JOLIET_MAX_STOCKS ||
    new Set(rows.map((row) => row.stock)).size !== rows.length
  )
    throw new Error("Joliet stock scope is empty, oversized or duplicated");
  const pairs = [
    ...new Map(
      rows.map((row) => [
        jolietPairKey(row),
        { make: row.make, model: row.model },
      ]),
    ).values(),
  ].sort((a, b) =>
    jolietPairKey(a) < jolietPairKey(b)
      ? -1
      : jolietPairKey(a) > jolietPairKey(b)
        ? 1
        : 0,
  );
  if (pairs.length > JOLIET_MAX_QUERIES)
    throw new Error(
      "Joliet native query directory exceeds the bounded traversal limit",
    );
  return { rows, pairs };
}
const configSchema = z.object({
  success: z.literal(true),
  yard_info: z.object({
    yard_id: z.literal("joliet_u_pull_it"),
    yard_name: z.literal(JOLIET_YARD.name),
    business_name: z.literal(JOLIET_YARD.name),
    multi_location_enabled: z.literal(false),
    per_location_mode_enabled: z.literal(false),
    locations: z.array(z.unknown()).length(0),
    photos_enabled: z.literal(false),
    timezone: z.literal("America/Chicago"),
    features: z.object({
      demo_freshness_enabled: z.literal(false),
      demo_synthesize_alert_matches: z.literal(false),
      hide_vehicle_search: z.literal(false),
      alert_only_mode: z.literal(false),
      store_phone: z.literal("(815) 723-3011"),
    }),
    url_settings: z.object({ custom_slug: z.literal("joliet") }),
  }),
});
export function parseJolietConfig(raw: string) {
  return configSchema.parse(JSON.parse(raw));
}
