import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  parseVinplusSearch,
  type VinplusPair,
  type VinplusRecord,
} from "./vinplus-protocol";
import { vinplusPublicQuery } from "./vinplus-public-enrichment";
import {
  PIPES_API_OWNER,
  PIPES_API_SITE,
  PIPES_EMBED_URL,
  PIPES_INVENTORY_URL,
  PIPES_LOCATION_ID,
  PIPES_YARD,
} from "./pipes-yard-metadata";

export const PIPES_MAX_MAKES = 64;
export const PIPES_MAX_STOCKS = 2_000;
export const PIPES_MAX_QUERIES = 1_024;
export const PIPES_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const PipesStockSchema = z.string().regex(/^STK\d{6}$/);
const text = z.string().max(512);
const url = z.string().max(2048);
export const PipesNativeRowSchema = z
  .object({
    rawYear: text,
    year: z.number().int().min(1886).max(2100).nullable(),
    make: text,
    model: text,
    color: text.nullable(),
    reference: text.nullable(),
    row: text.nullable(),
    arrivalDate: text.nullable(),
    stock: PipesStockSchema.nullable(),
    photos: z.array(url).max(8),
    images: z.array(url).max(8),
  })
  .strict();
export type PipesNativeRow = z.infer<typeof PipesNativeRowSchema>;
export type PipesPair = VinplusPair;
export type PipesRecord = VinplusRecord & { recencyAnchor?: unknown };
export const pipesHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const pipesBodyHash = (raw: string) =>
  createHash("sha256").update(raw).digest("hex");
export const pipesPairKey = (pair: PipesPair) =>
  JSON.stringify([pair.make, pair.model]);
export const PIPES_SCOPE = {
  yardId: PIPES_API_OWNER,
  yardName: PIPES_API_SITE,
  sourceSystem: "crush",
  stockSchema: PipesStockSchema,
  maxStocks: PIPES_MAX_STOCKS,
};
export const pipesQuery = (pair: PipesPair) =>
  vinplusPublicQuery(PIPES_SCOPE, pair, {
    kind: "per-location",
    id: PIPES_LOCATION_ID,
  });

function cell(raw: string): string {
  const entities = new Map([
    ["amp", "&"],
    ["nbsp", " "],
    ["quot", '"'],
    ["apos", "'"],
    ["lt", "<"],
    ["gt", ">"],
  ]);
  const decoded = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, name: string) => {
      if (!name.startsWith("#")) {
        const found = entities.get(name.toLowerCase());
        if (found === undefined)
          throw new Error("Unsupported Pipes character reference " + entity);
        return found;
      }
      const hex = /^#x/i.test(name);
      const point = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid Pipes character reference");
      return String.fromCodePoint(point);
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.parse(decoded);
}
function document(raw: string): string {
  if (
    Buffer.byteLength(raw) > PIPES_MAX_RESPONSE_BYTES ||
    !/<\/html>\s*$/i.test(raw)
  )
    throw new Error("Pipes HTML is oversized or truncated");
  const inertRemoved = raw.replace(
    /<(template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  if (/<\/?(?:template|noscript)\b/i.test(inertRemoved))
    throw new Error("Pipes HTML contains an incomplete inert element");
  const html = stripInventoryRawText(inertRemoved);
  const visible = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) =>
    inventoryHtmlAttribute(tag, "href"),
  );
  if (
    !visible.includes("806 Aero Drive") ||
    !visible.includes("Shreveport, LA 71107") ||
    !links.includes("tel:318-222-9547") ||
    !links.some(
      (href) =>
        href && new URL(href, PIPES_INVENTORY_URL).href === PIPES_INVENTORY_URL,
    ) ||
    /(?:inventory|vehicle search)\s+(?:is\s+)?(?:disabled|archived|unavailable)/i.test(
      visible,
    )
  )
    throw new Error(
      "Pipes native ownership, inventory navigation or active scope changed",
    );
  return html;
}
export function parsePipesOwner(raw: string) {
  const html = document(raw);
  const visible = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  if (
    !visible.includes("Self-Service Auto Parts Store") ||
    !visible.includes("Bring your tools to Pipes U-Pull-It") ||
    !visible.includes("not affiliated with U Auto Pull It Auto Parts")
  )
    throw new Error(
      "Pipes no longer confirms its separate active self-service donor inventory",
    );
  return { yard: PIPES_YARD, activeSelfService: true, separateFromUapi: true };
}
export function parsePipesDirections(raw: string) {
  const visible = document(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
  if (
    !visible.includes("318-222-2277") ||
    !visible.includes("Self-Service Auto Parts")
  )
    throw new Error("Pipes Directions physical ownership changed");
  return {
    address: PIPES_YARD.address,
    phone: PIPES_YARD.phone,
    directionsPhone: "318-222-2277",
  };
}
export function parsePipesMenu(raw: string): string[] {
  const html = document(raw);
  const forms = [
    ...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi),
  ].filter(
    (m) => inventoryHtmlAttribute(m[1] ?? "", "id") === "searchinventory",
  );
  const form = forms[0];
  if (
    forms.length !== 1 ||
    !form ||
    inventoryHtmlAttribute(form[1] ?? "", "action") !== "/Home/Inventory" ||
    inventoryHtmlAttribute(form[1] ?? "", "method")?.toLowerCase() !== "post"
  )
    throw new Error("Pipes exact native inventory form changed");
  const selects = [
    ...(form[2] ?? "").matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi),
  ];
  const make = selects.filter(
    (m) => inventoryHtmlAttribute(m[1] ?? "", "name") === "VehicleMake",
  );
  const model = selects.filter(
    (m) => inventoryHtmlAttribute(m[1] ?? "", "name") === "VehicleModel",
  );
  if (
    make.length !== 1 ||
    model.length !== 1 ||
    !/<option\b[^>]*value=""[^>]*>Select Model<\/option>/i.test(
      model[0]?.[2] ?? "",
    )
  )
    throw new Error("Pipes native make/model traversal controls changed");
  const makes = [
    ...(make[0]?.[2] ?? "").matchAll(
      /<option\b([^>]*)>([\s\S]*?)<\/option\s*>/gi,
    ),
  ].flatMap((m) => {
    const value = inventoryHtmlAttribute(m[1] ?? "", "value");
    if (!value) return [];
    const decoded = cell(value);
    if (decoded !== cell(m[2] ?? "") || !decoded)
      throw new Error("Pipes native make label and literal value disagree");
    return [decoded];
  });
  if (
    !makes.length ||
    makes.length > PIPES_MAX_MAKES ||
    new Set(makes).size !== makes.length
  )
    throw new Error("Pipes make directory is empty, oversized or duplicated");
  const bridge = [...html.matchAll(/<a\b[^>]*>/gi)].some(
    ([tag]) => inventoryHtmlAttribute(tag, "href") === PIPES_EMBED_URL,
  );
  if (!bridge)
    throw new Error(
      "Pipes published per-location identity destination changed",
    );
  return makes;
}

function tables(html: string): string[] {
  const stack: number[] = [],
    found: string[] = [];
  for (const match of html.matchAll(/<\/?table\b[^>]*>/gi)) {
    const position = match.index;
    if (/^<table/i.test(match[0])) stack.push(position + match[0].length);
    else {
      const start = stack.pop();
      if (start === undefined)
        throw new Error("Pipes has an unmatched table closing boundary");
      found.push(html.slice(start, position));
    }
  }
  if (stack.length) throw new Error("Pipes has a truncated table");
  return found;
}
export function pipesPhotoStock(value: string): string | null {
  const parsed = URL.parse(value);
  return parsed &&
    parsed.origin === "https://www.pipesupullit.net" &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash
    ? (/^\/PipesPhotos\/(STK\d{6})\.jpg$/.exec(parsed.pathname)?.[1] ?? null)
    : null;
}
export function parsePipesInventory(raw: string, selectedMake: string | null) {
  const html = document(raw),
    makes = parsePipesMenu(raw);
  const pager = [
    ...html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi),
  ].some((match) => {
    const attributes = match[2] ?? "";
    const href = inventoryHtmlAttribute(attributes, "href");
    const target = href ? URL.parse(href, PIPES_INVENTORY_URL) : null;
    return (
      /^(?:Next|Last|Load More)$/i.test(cell(match[3] ?? "")) ||
      /(?:^|\s)(?:next|last)(?:\s|$)/i.test(
        inventoryHtmlAttribute(attributes, "rel") ?? "",
      ) ||
      (target?.pathname === "/Home/Inventory" &&
        [...target.searchParams.keys()].some((key) =>
          /^(?:page|offset|skip|cursor)$/i.test(key),
        ))
    );
  });
  if (
    pager ||
    /\bclass\s*=\s*["'][^"']*\b(?:pagination|paginate)\b|\bdata-(?:page|total-pages)\s*=/i.test(
      html,
    )
  )
    throw new Error("Pipes inventory gained unhandled document pagination");
  const expected = [
    "YEAR",
    "MAKE",
    "MODEL",
    "COLOR",
    "REFERENCE",
    "ROW",
    "ARRIVAL DATE",
    "PHOTO",
  ];
  const candidates = tables(html).filter(
    (table) =>
      [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)]
        .map((m) => cell(m[1] ?? ""))
        .join("|") === expected.join("|"),
  );
  const table = candidates[0];
  if (candidates.length !== 1 || table === undefined || /<table\b/i.test(table))
    throw new Error(
      "Pipes complete eight-column donor table is missing or ambiguous",
    );
  if (
    /\b(?:pagination|paginate|data-page|data-total-pages)\b|>\s*(?:Next|Last|Load More)\s*</i.test(
      table,
    )
  )
    throw new Error("Pipes inventory gained unhandled pagination");
  const rowMatches = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
  if (
    rowMatches.length * 2 !== [...table.matchAll(/<\/?tr\b/gi)].length ||
    table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()
  )
    throw new Error("Pipes donor table contains truncated or out-of-row cells");
  const rows: PipesNativeRow[] = [];
  for (const [index, match] of rowMatches.entries()) {
    const row = match[1] ?? "";
    if (index === 0) {
      if (/<td\b/i.test(row) || [...row.matchAll(/<\/?th\b/gi)].length !== 16)
        throw new Error("Pipes donor header boundary changed");
      continue;
    }
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td\s*>/gi)].map(
      (m) => m[1] ?? "",
    );
    if (
      cells.length !== 8 ||
      [...row.matchAll(/<\/?td\b/gi)].length !== 16 ||
      row.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()
    )
      throw new Error("Pipes donor row lacks eight complete cells");
    const values = cells.map(cell),
      rawYear = values[0] ?? "",
      make = values[1] ?? "";
    if (selectedMake === null || (make && make !== selectedMake))
      throw new Error("Pipes native row escaped its published make control");
    const photoCell = cells[7] ?? "";
    const references = (tag: "a" | "img", attr: "href" | "src") =>
      [...photoCell.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].flatMap(
        ([value]) => {
          const href = inventoryHtmlAttribute(value, attr);
          return href ? [new URL(href, PIPES_INVENTORY_URL).href] : [];
        },
      );
    const photos = references("a", "href"),
      images = references("img", "src");
    const keys = new Set(
      [...photos, ...images].flatMap((value) => {
        const key = pipesPhotoStock(value);
        return key ? [key] : [];
      }),
    );
    if (keys.size > 1)
      throw new Error(
        "Pipes native photo references disagree on their stock association",
      );
    const year =
      /^\d{4}$/.test(rawYear) &&
      Number(rawYear) >= 1886 &&
      Number(rawYear) <= 2100
        ? Number(rawYear)
        : null;
    rows.push(
      PipesNativeRowSchema.parse({
        rawYear,
        year,
        make,
        model: values[2] ?? "",
        color: values[3] || null,
        reference: values[4] || null,
        row: values[5] || null,
        arrivalDate: values[6] || null,
        stock: [...keys][0] ?? null,
        photos,
        images,
      }),
    );
  }
  if (rows.length > PIPES_MAX_STOCKS)
    throw new Error("Pipes native table exceeds its bounded row capacity");
  return { makes, rows };
}
export function pipesPairs(rows: readonly PipesNativeRow[]): PipesPair[] {
  const pairs = [
    ...new Map(
      rows
        .filter((r) => r.make && r.model)
        .map((r) => [pipesPairKey(r), { make: r.make, model: r.model }]),
    ).values(),
  ].sort((a, b) =>
    pipesPairKey(a) < pipesPairKey(b)
      ? -1
      : pipesPairKey(a) > pipesPairKey(b)
        ? 1
        : 0,
  );
  if (pairs.length > PIPES_MAX_QUERIES)
    throw new Error(
      "Pipes literal query directory exceeds its bounded capacity",
    );
  return pairs;
}

const extension = z
  .object({
    matches: z
      .array(z.object({ recencyAnchor: z.unknown().optional() }).passthrough())
      .max(PIPES_MAX_STOCKS),
  })
  .passthrough();
export function parsePipesSearch(raw: string, pair: PipesPair): PipesRecord[] {
  if (Buffer.byteLength(raw) > PIPES_MAX_RESPONSE_BYTES)
    throw new Error("Pipes identity response is oversized");
  const source = extension.parse(JSON.parse(raw));
  const base = parseVinplusSearch(
    JSON.stringify({
      ...source,
      matches: source.matches.map(
        ({ recencyAnchor: _anchor, ...record }) => record,
      ),
    }),
    PIPES_SCOPE,
    pair,
  );
  return base.map((record, index) => {
    const original = source.matches[index];
    return original && Object.hasOwn(original, "recencyAnchor")
      ? { ...record, recencyAnchor: original.recencyAnchor }
      : record;
  });
}
export function pipesRecordHash(record: PipesRecord) {
  return pipesHash({ ...record, daysInYard: undefined });
}

const location = z.object({
  location_id: z.string().min(1).max(100),
  location_name: z.string().min(1).max(100),
  city: z.string().max(100),
  state: z.string().max(2),
});
const config = z.object({
  success: z.literal(true),
  yard_info: z.object({
    yard_id: z.literal(PIPES_API_OWNER),
    business_name: z.literal("Tri-State Iron & Metal"),
    yard_name: z.literal("Tri-State Iron & Metal"),
    resolved_location_id: z.literal(PIPES_LOCATION_ID),
    multi_location_enabled: z.literal(true),
    per_location_mode_enabled: z.literal(true),
    timezone: z.literal("America/Chicago"),
    photos_enabled: z.boolean(),
    locations: z.array(location).min(1).max(32),
    features: z.object({
      demo_freshness_enabled: z.literal(false),
      demo_synthesize_alert_matches: z.literal(false),
      hide_vehicle_search: z.literal(false),
      alert_only_mode: z.literal(false),
    }),
    url_settings: z.object({
      flat_location_slugs: z.object({
        "pipes-shreveport": z.literal(PIPES_LOCATION_ID),
      }),
    }),
    archived: z.literal(false).optional(),
    inactive: z.literal(false).optional(),
    disabled: z.literal(false).optional(),
    active: z.literal(true).optional(),
  }),
});
export function parsePipesConfig(raw: string) {
  const parsed = config.parse(JSON.parse(raw));
  const sites = parsed.yard_info.locations;
  const own = sites.filter((site) => site.location_id === PIPES_LOCATION_ID);
  if (
    new Set(sites.map((site) => site.location_id)).size !== sites.length ||
    own.length !== 1 ||
    own[0]?.location_name !== PIPES_API_SITE ||
    own[0]?.city !== "Shreveport" ||
    own[0]?.state !== "LA"
  )
    throw new Error(
      "Pipes public metadata no longer resolves its exact owned Louisiana location",
    );
  return parsed;
}
