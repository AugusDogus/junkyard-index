import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  inventoryTableSections,
  stripInventoryRawText,
} from "./inventory-html";
import {
  vinplusCalendarDate,
  vinplusOptionalText,
  VinplusYearSchema,
  type VinplusPair,
  type VinplusRecord,
  type VinplusScope,
} from "./vinplus-protocol";
import {
  UWRENCH_EMBED_URL,
  UWRENCH_INVENTORY_URL,
  UWRENCH_ORIGIN,
  UWRENCH_YARD,
} from "./uwrench-yard-metadata";

export const UWRENCH_MAX_STOCKS = 10_000;
export const UWRENCH_MAX_QUERIES = 2_000;
export const UwrenchStockSchema = z.string().regex(/^STK\d{6}$/);
export const UWRENCH_SCOPE = {
  yardId: "tri_state_u_wrench_and_save",
  yardName: UWRENCH_YARD.name,
  sourceSystem: "crush",
  stockSchema: UwrenchStockSchema,
  maxStocks: UWRENCH_MAX_STOCKS,
} satisfies VinplusScope;
export type UwrenchPair = VinplusPair;
export type UwrenchRecord = VinplusRecord;
export interface UwrenchNativeRow extends UwrenchPair {
  year: number | null;
  sourceYear: string;
  stock: string;
  color: string;
  engine: string;
  row: string;
  sourceSetDate: string;
}
export const uwrenchPairKey = (pair: UwrenchPair): string =>
  JSON.stringify([pair.make, pair.model]);
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export const uwrenchHash = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");

const scriptTokens =
  /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g;
function activeScripts(raw: string): string[] {
  return [
    ...raw
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi),
  ].map((match) =>
    (match[1] ?? "").replace(scriptTokens, (token) =>
      token.startsWith("//") || token.startsWith("/*") ? " " : token,
    ),
  );
}

function cellText(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
    ["mdash", String.fromCodePoint(8212)],
    ["copy", String.fromCodePoint(169)],
    ["raquo", String.fromCodePoint(187)],
  ]);
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const text = entities.get(key.toLowerCase());
        if (text === undefined)
          throw new Error("Unsupported Tri-State native entity " + entity);
        return text;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Tri-State native character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
}
function ownedDocument(raw: string, canonical: string): string {
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024 || !/<\/html>\s*$/i.test(raw))
    throw new Error("Tri-State HTML is oversized or truncated");
  const html = stripInventoryRawText(raw);
  const body = cellText(html);
  const canonicalLinks = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => inventoryHtmlAttribute(tag, "rel") === "canonical",
  );
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    canonicalLinks.length !== 1 ||
    inventoryHtmlAttribute(canonicalLinks[0]?.[0] ?? "", "href") !==
      canonical ||
    !body.includes(UWRENCH_YARD.name) ||
    !body.includes("3310 Old Cape Rd, Jackson Missouri") ||
    !body.includes(UWRENCH_YARD.phone) ||
    !links.includes(UWRENCH_INVENTORY_URL)
  )
    throw new Error(
      "Tri-State native physical ownership, canonical page or inventory destination changed",
    );
  return html;
}
export function parseUwrenchOwner(raw: string): void {
  const body = cellText(ownedDocument(raw, UWRENCH_ORIGIN + "/"));
  const embeds = activeScripts(raw).flatMap((script) => {
    const strings = [...script.matchAll(scriptTokens)];
    return [
      ...script.matchAll(/\biframe\.src\s*=\s*(["'])(.*?)\1\s*;/g),
    ].filter(
      (match) =>
        !strings.some(
          (token) =>
            match.index >= token.index &&
            match.index < token.index + token[0].length,
        ),
    );
  });
  if (
    embeds.length !== 1 ||
    embeds[0]?.[2] !== UWRENCH_EMBED_URL ||
    !body.includes(
      "All of our vehicles are lifted for convenient, easy access under the vehicle.",
    ) ||
    !body.includes(
      "We pass savings on to you by letting you bring your own tools, and take off your own parts.",
    )
  )
    throw new Error(
      "Tri-State active self-service scope or source-owned public catalog bridge changed",
    );
}
function tableRows(section: string, cell: "th" | "td"): string[][] {
  const rows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rows.length !== [...section.matchAll(/<\/?tr\b/gi)].length / 2 ||
    section.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error(
      "Tri-State native table has incomplete rows or out-of-row cells",
    );
  return rows.map((match) => {
    const row = match[1] ?? "";
    const pattern = new RegExp(
      `<${cell}\\b[^>]*>([\\s\\S]*?)<\\/${cell}\\s*>`,
      "gi",
    );
    const cells = [...row.matchAll(pattern)];
    if (
      cells.length !== 8 ||
      [...row.matchAll(/<\/?(?:td|th)\b/gi)].length !== 16 ||
      row.replace(pattern, "").trim()
    )
      throw new Error(
        "Tri-State native inventory row lacks eight complete cells",
      );
    return cells.map((value) => cellText(value[1] ?? ""));
  });
}
export function uwrenchNativeDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(value);
  // Check the suffix's leap class only; 00 remains plausible without choosing a century.
  return match &&
    vinplusCalendarDate(
      2000 + Number(match[3]),
      Number(match[1]),
      Number(match[2]),
    )
    ? value
    : null;
}
export function parseUwrenchInventory(raw: string) {
  const html = ownedDocument(raw, UWRENCH_INVENTORY_URL);
  if (
    activeScripts(raw).some(
      (script) =>
        /["']#vehicles["']/.test(script) &&
        /\.dataTable\s*\(/i.test(script) &&
        /["']?(?:serverSide|ajax)["']?\s*:\s*(?:true|["'{])/i.test(script),
    )
  )
    throw new Error(
      "Tri-State native inventory enables remote DataTables donor loading; complete enumeration is unproved",
    );
  const all = [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)];
  const tables = all.filter(
    (match) => inventoryHtmlAttribute(match[1] ?? "", "id") === "vehicles",
  );
  if (
    tables.length !== 1 ||
    all.length !== [...html.matchAll(/<table\b/gi)].length ||
    all.length !== [...html.matchAll(/<\/table\b/gi)].length
  )
    throw new Error(
      "Tri-State complete native inventory table is missing or ambiguous",
    );
  const outside = html.replace(tables[0]?.[0] ?? "", "");
  const inventoryPagination = [
    ...outside.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav\s*>/gi),
  ].some(
    (match) =>
      /(?:inventory|vehicle).*pagin|pagin.*(?:inventory|vehicle)/i.test(
        inventoryHtmlAttribute(match[1] ?? "", "aria-label") ?? "",
      ) && /<a\b/i.test(match[2] ?? ""),
  );
  const inventoryNext = [
    ...outside.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi),
  ].some((match) => {
    const href = inventoryHtmlAttribute(match[1] ?? "", "href");
    const url = href ? URL.parse(href, UWRENCH_INVENTORY_URL) : null;
    const paginated =
      url !== null &&
      (/\/page\/\d+\/?$/.test(url.pathname) ||
        ["page", "paged", "offset"].some((key) => url.searchParams.has(key)));
    const next =
      paginated ||
      (inventoryHtmlAttribute(match[1] ?? "", "rel") ?? "")
        .split(/\s+/)
        .includes("next") ||
      /\b(?:next|more|older)\b/i.test(cellText(match[2] ?? ""));
    return (
      next &&
      url?.origin === UWRENCH_ORIGIN &&
      /^\/inventory(?:\/|$)/.test(url.pathname) &&
      (!/^\/inventory\/?$/.test(url.pathname) || url.search !== "")
    );
  });
  if (inventoryPagination || inventoryNext)
    throw new Error(
      "Tri-State native inventory advertises server-side donor continuation; complete enumeration is unproved",
    );
  const sections = inventoryTableSections(tables[0]?.[2] ?? "");
  if (
    JSON.stringify(tableRows(sections.head, "th")) !==
    JSON.stringify([
      [
        "Year",
        "Make",
        "Model",
        "Color",
        "Engine",
        "Stock#",
        "Vehicle Row",
        "Date Set in Yard",
      ],
    ])
  )
    throw new Error("Tri-State native inventory headers changed");
  const rows = tableRows(sections.body, "td").map((cells): UwrenchNativeRow => {
    const [year, make, model, color, engine, stock, row, date] = z
      .tuple([
        z.string(),
        z.string(),
        z.string(),
        z.string(),
        z.string(),
        UwrenchStockSchema,
        z.string(),
        z.string(),
      ])
      .parse(cells);
    const parsedYear = /^\d{4}$/.test(year)
      ? VinplusYearSchema.safeParse(Number(year))
      : null;
    return {
      year: parsedYear?.success ? parsedYear.data : null,
      sourceYear: year,
      make,
      model,
      color,
      engine,
      stock,
      row,
      sourceSetDate: date,
    };
  });
  if (
    !rows.length ||
    rows.length > UWRENCH_MAX_STOCKS ||
    new Set(rows.map((row) => row.stock)).size !== rows.length
  )
    throw new Error(
      "Tri-State native stock census is empty, oversized or duplicated",
    );
  const pairs = [
    ...new Map(
      rows
        .filter(
          (row) =>
            vinplusOptionalText(row.make) && vinplusOptionalText(row.model),
        )
        .map((row) => [
          uwrenchPairKey(row),
          { make: row.make, model: row.model },
        ]),
    ).values(),
  ].sort((a, b) =>
    uwrenchPairKey(a) < uwrenchPairKey(b)
      ? -1
      : uwrenchPairKey(a) > uwrenchPairKey(b)
        ? 1
        : 0,
  );
  if (!pairs.length || pairs.length > UWRENCH_MAX_QUERIES)
    throw new Error(
      "Tri-State literal native query scope is empty or oversized",
    );
  return { rows, pairs };
}
const configSchema = z.object({
  success: z.literal(true),
  yard_info: z.object({
    yard_id: z.literal(UWRENCH_SCOPE.yardId),
    yard_name: z.literal(UWRENCH_YARD.name),
    business_name: z.literal(UWRENCH_YARD.name),
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
    }),
    url_settings: z.object({ custom_slug: z.literal("uwrench") }),
  }),
});
export const parseUwrenchConfig = (raw: string) =>
  configSchema.parse(JSON.parse(raw));
