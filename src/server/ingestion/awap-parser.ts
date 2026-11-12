import { createHash } from "node:crypto";
import { z } from "zod";
import {
  inventoryHtmlAttribute,
  stripInventoryRawText,
} from "./inventory-html";
import {
  AWAP_ABOUT,
  AWAP_ORIGIN,
  awapCatalogPage,
  awapImage,
  isAwapDonorUrl,
} from "./awap-yard-metadata";

export const AWAP_PAGE_SIZE = 25;
export const AWAP_MAX_PAGES = 32;
export const awapHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const boundedText = z.string().max(500);
export const AwapRecordSchema = z
  .object({
    detailsUrl: z.string().max(1000).refine(isAwapDonorUrl),
    title: boundedText,
    year: boundedText,
    make: boundedText,
    model: boundedText,
    vinClaims: z.array(z.string().max(100)).max(2),
    skuClaim: boundedText.nullable(),
    color: boundedText.nullable(),
    engine: boundedText.nullable(),
    transmission: boundedText.nullable(),
    imageUrl: z
      .string()
      .max(2000)
      .refine((raw) => awapImage(raw) !== null)
      .nullable(),
  })
  .strict();
export type AwapRecord = z.infer<typeof AwapRecordSchema>;
export const AwapPageSchema = z
  .object({
    url: z.string().refine((raw) => awapCatalogPage(raw) !== null),
    page: z.number().int().min(1).max(AWAP_MAX_PAGES),
    total: z
      .number()
      .int()
      .min(1)
      .max(AWAP_MAX_PAGES * AWAP_PAGE_SIZE),
    next: z
      .string()
      .refine((raw) => awapCatalogPage(raw) !== null)
      .nullable(),
    records: z.array(AwapRecordSchema).min(1).max(AWAP_PAGE_SIZE),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type AwapPage = z.infer<typeof AwapPageSchema>;
export const awapPageHash = (page: Omit<AwapPage, "hash">) =>
  awapHash([page.url, page.page, page.total, page.next, page.records]);

function text(raw: string, normalizeWhitespace = true): string {
  const named = new Map([
    ["amp", "&"],
    ["quot", '"'],
    ["apos", "'"],
    ["nbsp", " "],
    ["lt", "<"],
    ["gt", ">"],
    ["ndash", "–"],
    ["raquo", "»"],
    ["laquo", "«"],
    ["hellip", "…"],
  ]);
  const decoded = (
    normalizeWhitespace ? raw.replace(/<[^>]*>/g, " ") : raw
  ).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity: string, key: string) => {
    if (!key.startsWith("#")) {
      const value = named.get(key.toLowerCase());
      if (value === undefined)
        throw new Error("Unsupported AWAP character reference " + entity);
      return value;
    }
    const hex = /^#x/i.test(key);
    const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
      throw new Error("Invalid AWAP character reference");
    return String.fromCodePoint(point);
  });
  return normalizeWhitespace ? decoded.replace(/\s+/g, " ").trim() : decoded;
}
const attr = (tag: string, key: string) => {
  const raw = inventoryHtmlAttribute(tag, key);
  return raw === null ? null : text(raw, false);
};
const hasClass = (tag: string, name: string) =>
  (attr(tag, "class") ?? "").split(/\s+/).includes(name);

/** Balanced div regions exclude scripts, navigation and component catalogs. */
function divs(html: string, name: string): string[] {
  const result: string[] = [];
  let start: number | null = null;
  let depth = 0;
  for (const match of html.matchAll(/<\/?div\b[^>]*>/gi)) {
    const closing = /^<\//.test(match[0]);
    if (start === null) {
      if (!closing && hasClass(match[0], name)) {
        start = match.index + match[0].length;
        depth = 1;
      }
    } else if (closing) {
      if (--depth === 0) {
        result.push(html.slice(start, match.index));
        start = null;
      }
    } else {
      if (hasClass(match[0], name)) throw new Error("Nested AWAP " + name);
      depth++;
    }
  }
  if (start !== null) throw new Error("Unclosed AWAP " + name);
  return result;
}
function oneDiv(html: string, name: string): string {
  const matches = divs(html, name);
  const value = matches[0];
  if (matches.length !== 1 || value === undefined)
    throw new Error("Expected one complete AWAP " + name);
  return value;
}
function document(raw: string, url: string): string {
  const html = stripInventoryRawText(raw);
  if (
    Buffer.byteLength(raw) > 2 * 1024 * 1024 ||
    !/<\/html\s*>\s*$/i.test(html)
  )
    throw new Error("AWAP document is oversized or truncated");
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].filter(
    ([tag]) => attr(tag, "rel") === "canonical",
  );
  if (canonicals.length !== 1 || attr(canonicals[0]?.[0] ?? "", "href") !== url)
    throw new Error(
      "AWAP canonical destination contradicts requested native control",
    );
  const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  if (
    titles.length !== 1 ||
    !text(titles[0]?.[1] ?? "").includes("Alabama Wholesale Auto Parts")
  )
    throw new Error("AWAP native business identity changed");
  return html;
}
export function parseAwapIdentity(raw: string): void {
  const body = text(document(raw, AWAP_ABOUT));
  if (
    !body.includes("Based in Birmingham, Alabama") ||
    !body.includes("Birmingham, AL 35211") ||
    !body.includes("205-538-2538")
  )
    throw new Error(
      "AWAP native physical owner city, postal code or phone changed",
    );
}
function links(html: string, name: string) {
  return [...html.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)].filter((match) =>
    hasClass(match[1] ?? "", name),
  );
}
function queryControl(
  html: string,
  name: string,
  path: string,
  keys: readonly string[],
): URLSearchParams | null {
  const matches = links(html, name);
  if (matches.length === 0) return null;
  const raw = attr(matches[0]?.[1] ?? "", "href");
  const url = raw ? URL.parse(raw) : null;
  if (
    matches.length !== 1 ||
    !url ||
    url.origin !== AWAP_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    url.pathname !== path ||
    [...url.searchParams.keys()].some((key) => !keys.includes(key)) ||
    keys.some((key) => key !== "sku" && url.searchParams.getAll(key).length > 1)
  )
    throw new Error("AWAP native metadata control is foreign or ambiguous");
  return url.searchParams;
}
function optionalText(raw: string): string | null {
  try {
    return text(raw);
  } catch {
    return null;
  }
}
function optionalImage(card: string): string | null {
  try {
    const images = [
      ...new Set(
        [...card.matchAll(/<img\b[^>]*>/gi)]
          .flatMap(([tag]) => [
            awapImage(attr(tag, "data-src")),
            awapImage(attr(tag, "src")),
          ])
          .filter((image) => image !== null),
      ),
    ];
    return images.length === 1 ? (images[0] ?? null) : null;
  } catch {
    return null;
  }
}
const optional = (values: (string | null)[]) => {
  if (
    values.some(
      (value) =>
        value === null ||
        value.length > 500 ||
        [...value].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
    )
  )
    return null;
  const unique = [
    ...new Set(
      values
        .filter((value) => value !== null)
        .map((value) => value.trim())
        .filter(
          (value) =>
            value &&
            !/^(?:unknown|other|n\/?a|null|none|not specified|not available|-)$/i.test(
              value,
            ),
        ),
    ),
  ];
  return unique.length === 1 ? (unique[0] ?? null) : null;
};
function record(card: string): AwapRecord {
  const titles = links(card, "awap-cy-card-title");
  const title = text(titles[0]?.[2] ?? "");
  const detailsUrl = attr(titles[0]?.[1] ?? "", "href") ?? "";
  const thumbnails = links(card, "awap-cy-thumb");
  if (
    titles.length !== 1 ||
    !isAwapDonorUrl(detailsUrl) ||
    thumbnails.some((link) => attr(link[1] ?? "", "href") !== detailsUrl)
  )
    throw new Error("AWAP donor destination is missing or contradictory");
  const status = divs(card, "awap-cy-dismantling");
  if (
    status.some(
      (value) =>
        text(value)
          .replace(/[–-]/g, "")
          .trim() !== "Dismantling",
    )
  )
    throw new Error("AWAP active own-yard donor status changed");
  const metadata = queryControl(card, "awap-cy-inquiry", "/request-a-part/", [
    "vin",
    "year",
    "make",
    "model",
    "sku",
  ]);
  const parts = queryControl(card, "awap-cy-view", "/inventory/", ["vin"]);
  const specs = divs(card, "awap-cy-specs");
  const fields = specs
    .flatMap((spec) => [
      ...spec.matchAll(
        /<div\b[^>]*>\s*<b\b[^>]*>([\s\S]*?)<\/b>([\s\S]*?)<\/div>/gi,
      ),
    ])
    .map((match): [string | null, string | null] => [
      optionalText(match[1] ?? "")?.replace(/:$/, "") ?? null,
      optionalText(match[2] ?? ""),
    ]);
  const field = (key: string) =>
    optional(fields.filter((pair) => pair[0] === key).map((pair) => pair[1]));
  return AwapRecordSchema.parse({
    detailsUrl,
    title,
    year: metadata?.get("year")?.trim() ?? "",
    make: metadata?.get("make")?.trim() ?? "",
    model: metadata?.get("model")?.trim() ?? "",
    vinClaims: [metadata?.get("vin"), parts?.get("vin")].filter(
      (value) => value !== null && value !== undefined,
    ),
    skuClaim: optional(metadata?.getAll("sku") ?? []),
    color: field("Color"),
    engine: field("Engine"),
    transmission: field("Trans"),
    imageUrl: optionalImage(card),
  });
}
export function parseAwapPage(raw: string, url: string): AwapPage {
  const page = awapCatalogPage(url);
  if (page === null) throw new Error("Unpublished AWAP catalog destination");
  const html = document(raw, url);
  const scope = oneDiv(html, "awap-cy-wrap");
  const headings = [
    ...scope.matchAll(/(<h1\b[^>]*>)([\s\S]*?)<\/h1>/gi),
  ].filter((match) => hasClass(match[1] ?? "", "awap-cy-title"));
  const subtitles = [...scope.matchAll(/(<p\b[^>]*>)([\s\S]*?)<\/p>/gi)].filter(
    (match) => hasClass(match[1] ?? "", "awap-cy-subtitle"),
  );
  if (
    headings.length !== 1 ||
    text(headings[0]?.[2] ?? "") !==
      "Cars at Yard – Available Donor Vehicles" ||
    subtitles.length !== 1 ||
    text(subtitles[0]?.[2] ?? "") !==
      "Select a make, narrow by model, or use the filters below to find donor vehicles currently being dismantled."
  )
    throw new Error("AWAP available own-yard donor scope changed");
  const count = /^Showing (\d+) donor vehicles\s*\.$/.exec(
    text(oneDiv(scope, "awap-cy-meta")),
  );
  const total = Number(count?.[1]);
  const lastPage = Math.ceil(total / AWAP_PAGE_SIZE);
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    lastPage > AWAP_MAX_PAGES ||
    page > lastPage
  )
    throw new Error(
      "AWAP native donor count is missing or outside the finite page bound",
    );
  const grid = oneDiv(scope, "awap-cy-grid");
  const articles = [
    ...grid.matchAll(/(<article\b[^>]*>)([\s\S]*?)<\/article\s*>/gi),
  ];
  if (
    articles.length !== [...grid.matchAll(/<article\b/gi)].length ||
    articles.some((match) => !hasClass(match[1] ?? "", "awap-cy-card")) ||
    grid.replace(/<article\b[^>]*>[\s\S]*?<\/article\s*>/gi, "").trim()
  )
    throw new Error(
      "AWAP donor grid is truncated or contains unaccounted cards",
    );
  const records = articles.map((match) => record(match[2] ?? ""));
  if (
    records.length !==
    Math.min(AWAP_PAGE_SIZE, total - (page - 1) * AWAP_PAGE_SIZE)
  )
    throw new Error("AWAP native page count is short or oversized");
  const navigation = oneDiv(scope, "awap-cy-pagination");
  const current = [
    ...navigation.matchAll(/(<span\b[^>]*>)([\s\S]*?)<\/span>/gi),
  ].filter((match) => attr(match[1] ?? "", "aria-current") === "page");
  if (current.length !== 1 || text(current[0]?.[2] ?? "") !== String(page))
    throw new Error("AWAP ignored the requested native page");
  const next: string[] = [];
  const previous: string[] = [];
  for (const anchor of navigation.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/gi)) {
    const href = attr(anchor[1] ?? "", "href") ?? "";
    const number = awapCatalogPage(href);
    if (number === null || number > lastPage)
      throw new Error("AWAP pagination contains an unverified destination");
    if (hasClass(anchor[1] ?? "", "next")) next.push(href);
    else if (hasClass(anchor[1] ?? "", "prev")) previous.push(href);
    else if (text(anchor[2] ?? "") !== String(number))
      throw new Error("AWAP numbered pagination label contradicts destination");
  }
  if (
    next.length !== (page < lastPage ? 1 : 0) ||
    (next.length === 1 && awapCatalogPage(next[0] ?? "") !== page + 1) ||
    previous.length !== (page > 1 ? 1 : 0) ||
    (previous.length === 1 && awapCatalogPage(previous[0] ?? "") !== page - 1)
  )
    throw new Error(
      "AWAP next/previous pagination or terminal evidence changed",
    );
  const value = { url, page, total, next: next[0] ?? null, records };
  return AwapPageSchema.parse({ ...value, hash: awapPageHash(value) });
}
