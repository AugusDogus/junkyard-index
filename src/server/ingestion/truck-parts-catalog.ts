import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";

const field = z.string().max(500);
export const TruckPartsCatalogRecordSchema = z
  .object({
    id: z.string().regex(/^[1-9]\d{0,11}$/),
    year: field,
    make: field,
    model: field,
    vin: field,
    stockNumber: field.nullable(),
    imageUrl: z.string().max(4096).nullable(),
    detailsUrl: z.string().max(1000),
    condition: z.literal("Salvage"),
    engine: field.nullable(),
  })
  .strict();
export type TruckPartsCatalogRecord = z.infer<
  typeof TruckPartsCatalogRecordSchema
>;
export interface TruckPartsCatalogConfig {
  origin: string;
  listPath: string;
  detailPath: string;
  photoAccount: string;
}
export interface TruckPartsCatalogPage {
  page: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  lastPage: number;
  nextUrl: string | null;
  records: TruckPartsCatalogRecord[];
  hash: string;
}

function decode(raw: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return raw.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity: string, key: string) => {
      if (!key.startsWith("#")) {
        const value = named[key.toLowerCase()];
        if (value === undefined)
          throw new Error("Unsupported truck catalog entity " + entity);
        return value;
      }
      const hex = /^#x/i.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (
        point <= 0 ||
        point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff)
      )
        throw new Error("Invalid truck catalog character reference");
      return String.fromCodePoint(point);
    },
  );
}
const text = (raw: string) =>
  decode(raw.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const attr = (tag: string, name: string) => {
  const value = inventoryHtmlAttribute(tag, name);
  return value === null ? null : decode(value).trim();
};
const hasClass = (tag: string, name: string) =>
  (attr(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced div subtrees from the two inspected TPI server-rendered templates.
 * This does not repair truncated cards or execute publisher scripts.
 */
function divs(html: string, className: string): string[] {
  const blocks: string[] = [];
  let start: number | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const tag = match[0];
    const closing = /^<\//.test(tag);
    if (start === null) {
      if (!closing && hasClass(tag, className)) {
        start = match.index;
        depth = 1;
      }
    } else if (closing) {
      if (--depth === 0) {
        blocks.push(html.slice(start, match.index + tag.length));
        start = null;
      }
    } else {
      if (hasClass(tag, className))
        throw new Error("Nested truck catalog " + className);
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed truck catalog " + className);
  return blocks;
}

function navigationUrl(
  raw: string,
  page: number,
  config: TruckPartsCatalogConfig,
): string {
  const url = URL.parse(raw, config.origin);
  if (
    !url ||
    url.origin !== config.origin ||
    url.pathname !== config.listPath ||
    url.username ||
    url.password ||
    url.hash ||
    url.searchParams.getAll("f-condition").length !== 1 ||
    url.searchParams.get("f-condition") !== "nw" ||
    url.searchParams.getAll("page_number").length !== 1 ||
    url.searchParams.get("page_number") !== String(page) ||
    [...url.searchParams.keys()].some(
      (key) => key !== "f-condition" && key !== "page_number",
    )
  )
    throw new Error(
      "Truck catalog pagination left the verified native Salvage traversal",
    );
  return url.href;
}

function record(
  html: string,
  config: TruckPartsCatalogConfig,
): TruckPartsCatalogRecord {
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map(([tag]) => {
    const raw = attr(tag, "href");
    const url = raw === null ? null : URL.parse(raw, config.origin);
    if (
      !url ||
      url.origin !== config.origin ||
      ![config.detailPath, config.detailPath.replace(/\/$/, "")].includes(
        url.pathname,
      ) ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll("truck").length !== 1 ||
      [...url.searchParams.keys()].some((key) => key !== "truck")
    )
      throw new Error("Truck donor link left its native detail destination");
    return url.searchParams.get("truck");
  });
  const id = links[0];
  if (
    links.length !== 3 ||
    !id ||
    !/^[1-9]\d{0,11}$/.test(id) ||
    links.some((value) => value !== id)
  )
    throw new Error(
      "Truck card must publish three consistent native donor links",
    );
  const fields = new Map<string, string>();
  const labels = new Set([
    "Truck Make",
    "Truck Model",
    "Vin Number",
    "Lot Number",
    "Condition",
    "Engine Model",
  ]);
  for (const pair of html.matchAll(
    /<div\b[^>]*>\s*<h6\b[^>]*>((?:(?!<\/h6\b)[\s\S])*)<\/h6>\s*<\/div>\s*<div\b[^>]*>\s*<p\b[^>]*>((?:(?!<\/p\b)[\s\S])*)<\/p>\s*<\/div>/gi,
  )) {
    const label = text(pair[1] ?? "").replace(/\s*:\s*$/, "");
    if (!labels.has(label)) continue;
    if (fields.has(label))
      throw new Error("Repeated native truck field " + label);
    fields.set(label, text(pair[2] ?? ""));
  }
  if (fields.get("Condition") !== "Salvage")
    throw new Error(
      "Non-Salvage donor appeared in the active wrecking catalog",
    );
  const headings = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  if (headings.length !== 1)
    throw new Error("Truck donor heading is missing or ambiguous");
  const year = /^(\d{4})\s/.exec(text(headings[0]?.[1] ?? ""))?.[1] ?? "";
  const photos = [...html.matchAll(/<img\b[^>]*>/gi)].flatMap(([tag]) => {
    const raw = attr(tag, "data-src");
    const url = raw ? URL.parse(raw) : null;
    return url &&
      url.origin === "https://images.truckpartsinventory.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`/trucks/${config.photoAccount}/`) &&
      /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
      ? [url.href]
      : [];
  });
  return TruckPartsCatalogRecordSchema.parse({
    id,
    year,
    make: fields.get("Truck Make") ?? "",
    model: fields.get("Truck Model") ?? "",
    vin: fields.get("Vin Number") ?? "",
    stockNumber: fields.get("Lot Number") || null,
    imageUrl: photos[0] ?? null,
    detailsUrl: config.origin + config.detailPath + "?truck=" + id,
    condition: "Salvage",
    engine: fields.get("Engine Model") || null,
  });
}

export function parseTruckPartsCatalogPage(
  raw: string,
  requestedPage: number,
  config: TruckPartsCatalogConfig,
): TruckPartsCatalogPage {
  if (
    !Number.isSafeInteger(requestedPage) ||
    requestedPage < 1 ||
    requestedPage > 400 ||
    Buffer.byteLength(raw) > 4_000_000 ||
    !/<\/html\s*>\s*$/i.test(raw)
  )
    throw new Error(
      "Truck catalog page budget, size or complete HTML boundary is invalid",
    );
  const html = stripInventoryRawText(raw);
  const headings = divs(html, "filter-title").filter(
    (block) => text(block) === "Current Filters",
  );
  const heading = headings[0];
  if (headings.length !== 1 || heading === undefined)
    throw new Error("Native current filter heading is missing or ambiguous");
  const afterHeading = html.slice(html.indexOf(heading) + heading.length);
  // Native current selections precede div.well. Sidebar filter choices live
  // inside it and must never be mistaken for additional active selections.
  const options = [...afterHeading.matchAll(/<div\b[^>]*>/gi)].find(([tag]) =>
    hasClass(tag, "well"),
  );
  const current =
    options === undefined ? null : afterHeading.slice(0, options.index);
  if (
    current === null ||
    divs(current, "filter-list").length !== 1 ||
    text(current.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "")) !==
      "Condition: Salvage"
  )
    throw new Error(
      "Native current filters must contain only Condition: Salvage; an additional active filter cannot establish complete inventory",
    );
  const pagers = [...html.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)].filter(
    (m) => hasClass(m[1] ?? "", "pagination"),
  );
  if (pagers.length !== 2)
    throw new Error("Expected native header and footer truck pagination");
  const pagination = pagers.map((m) => m[2] ?? "").join("");
  const ranges = [...pagination.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi)]
    .filter((m) => hasClass(m[1] ?? "", "pagination-info"))
    .map((m) => text(m[2] ?? ""));
  const range = ranges[0];
  const match = /^(\d+)-(\d+) of (\d+)$/.exec(range ?? "");
  if (ranges.length !== 2 || ranges.some((value) => value !== range) || !match)
    throw new Error(
      "Truck catalog header/footer pagination is missing or inconsistent",
    );
  const rangeStart = Number(match[1]),
    rangeEnd = Number(match[2]),
    total = Number(match[3]);
  const lastPage = Math.ceil(total / 25);
  if (
    total < 1 ||
    total > 10_000 ||
    rangeStart !== (requestedPage - 1) * 25 + 1 ||
    rangeEnd !== Math.min(requestedPage * 25, total) ||
    requestedPage > lastPage
  )
    throw new Error(
      "Truck catalog pagination range differs from its requested page",
    );
  const active = [...pagination.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)]
    .filter((m) => hasClass(m[1] ?? "", "active"))
    .map((m) => text(m[2] ?? ""));
  if (
    active.length !== 2 ||
    active.some((value) => value !== String(requestedPage))
  )
    throw new Error("Truck catalog current page selection changed");
  const next = new Set<string>();
  for (const anchor of pagination.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const label = text(anchor[2] ?? "");
    if (label !== "Next Page" && label !== "Last Page") continue;
    const href = attr(anchor[1] ?? "", "href");
    if (href === null)
      throw new Error("Truck pagination link has no destination");
    const url = navigationUrl(
      href,
      label === "Next Page" ? requestedPage + 1 : lastPage,
      config,
    );
    if (label === "Next Page") next.add(url);
  }
  if (next.size !== (requestedPage < lastPage ? 1 : 0))
    throw new Error(
      "Truck catalog next page does not establish terminal traversal",
    );
  const records = divs(html, "list-item").map((card) => record(card, config));
  if (
    records.length !== rangeEnd - rangeStart + 1 ||
    new Set(records.map((row) => row.id)).size !== records.length
  )
    throw new Error(
      "Truck donor card count or native identities contradict pagination",
    );
  const page = {
    page: requestedPage,
    rangeStart,
    rangeEnd,
    total,
    lastPage,
    nextUrl: [...next][0] ?? null,
    records,
  };
  return {
    ...page,
    hash: createHash("sha256").update(JSON.stringify(page)).digest("hex"),
  };
}
